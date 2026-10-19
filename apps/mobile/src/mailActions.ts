import type { ImapSession } from '@peregrine/core/imapSession'
import type { QueueRunner } from '@peregrine/core/offlineQueue'
import {
  discardFailedActions,
  dropQueuedMoves,
  enqueueAction,
  pendingSummary
} from '@peregrine/core/pendingActionsStore'
import type { PendingSummary } from '@peregrine/core/pendingActions'
import type { SqlDb } from '@peregrine/core/sqlDb'
import type { ComposeInput } from '@peregrine/core/types'
import { getFolderBySpecialUse, type Folder } from './folders'
import { applyFlags, deleteMessages, setPendingMove } from './messages'

export interface MailContext {
  db: SqlDb
  queue: QueueRunner
  /** The open connection of an account, or null when it has none. */
  session(accountId: string): ImapSession | null
  log: { error(message: string): void }
}

/**
 * What the application does to mail: mark, move, delete, send.
 *
 * Every one of them takes the same two steps. The change is made to the local copy at once, so that
 * the list shows what the user did whether or not there is a connection, and the server is told
 * through the queue. There is no second path that goes to the server directly. With one, a decision
 * made while the queue still holds older ones would reach the server first, and what was decided
 * in a given order would happen in another. With the queue alone, the order is the order of the
 * decisions, a decision survives the application being closed, and an action that fails has a
 * reason and a number of attempts kept with it.
 *
 * When there is a connection the queue is run straight away, so that online it is the same as
 * doing it directly, only written down first.
 */
export class MailActions {
  /** One run of the queue after another per account, see `flush`. */
  private chains = new Map<string, Promise<void>>()

  constructor(private readonly context: MailContext) {}

  /** Adds and removes flags: `\Seen` for read, `\Flagged` for starred, a keyword for a tag. */
  async setFlags(folder: Folder, uids: number[], add: string[], remove: string[]): Promise<void> {
    if (uids.length === 0 || (add.length === 0 && remove.length === 0)) return
    const { db } = this.context
    await applyFlags(db, folder.id, uids, add, remove)
    await enqueueAction(db, folder.accountId, 'flags', { folderId: folder.id, uids, add, remove })
    await this.settle(folder.accountId)
  }

  /**
   * Moves messages to another folder of the same account.
   *
   * They stay in the list where they are, marked with where they are going, until the server has
   * moved them: carrying the rows into the target would give them a UID the server has not assigned,
   * and the next sync would fetch the same messages again under their real ones.
   */
  async move(folder: Folder, uids: number[], target: Folder): Promise<void> {
    if (uids.length === 0 || folder.id === target.id || folder.accountId !== target.accountId) return
    const { db } = this.context
    // A move already waiting for these messages is replaced and not queued behind: it would run
    // first and carry them to a place the user has since changed their mind about.
    await dropQueuedMoves(db, folder.accountId, folder.id, uids)
    await enqueueAction(db, folder.accountId, 'move', {
      sourceFolderId: folder.id,
      targetFolderId: target.id,
      uids
    })
    await setPendingMove(db, folder.id, uids, target.id)
    await this.settle(folder.accountId)
  }

  /**
   * Deletes messages: into the trash folder, or for good when there is none, when this is the trash
   * or when `permanent` says so. Which is what the desktop does, so an account behaves the same on
   * both.
   */
  async remove(folder: Folder, uids: number[], options: { permanent?: boolean } = {}): Promise<void> {
    if (uids.length === 0) return
    const { db } = this.context
    const trash = options.permanent ? undefined : await getFolderBySpecialUse(db, folder.accountId, '\\Trash')
    if (trash && trash.id !== folder.id) return this.move(folder, uids, trash)

    // Destroying a message settles where it was going: a move still waiting for it has nothing left.
    await dropQueuedMoves(db, folder.accountId, folder.id, uids)
    await enqueueAction(db, folder.accountId, 'delete', { folderId: folder.id, uids })
    await deleteMessages(db, folder.id, uids)
    await this.settle(folder.accountId)
  }

  /**
   * Puts a message to be sent into the queue. The message is the whole of what was written, and goes
   * out with the next run of the queue for its account, which is now when there is a connection.
   */
  async send(input: ComposeInput): Promise<void> {
    await enqueueAction(this.context.db, input.accountId, 'send', { input })
    await this.settle(input.accountId)
  }

  /** What waits, for a line on a screen: how many, and how many were given up on. */
  waiting(): Promise<PendingSummary> {
    return pendingSummary(this.context.db)
  }

  /** Gives up on what failed too often, which is what the user does after reading why it did. */
  async discardFailed(): Promise<void> {
    await discardFailedActions(this.context.db, (db, folderId, uids) => setPendingMove(db, folderId, uids, null))
    await this.context.queue.notify()
  }

  /**
   * Runs the queue of an account, if there is a connection, and says when it is done.
   *
   * A run that is under way does not see an action added after it started to read, and the queue
   * does nothing when asked to run twice at once. So each run waits for the one before it: the
   * action that was added in between is picked up by the run that follows, and not left until the
   * next time something runs the queue.
   */
  flush(accountId: string): Promise<void> {
    const previous = this.chains.get(accountId) ?? Promise.resolve()
    const next = previous.then(async () => {
      const session = this.context.session(accountId)
      if (!session) return
      await this.context.queue.flush(accountId, session)
    })
    // What went wrong with an action is kept with it, so an error here is about the queue itself.
    const settled = next.catch((error) => {
      this.context.log.error(`running the queue failed: ${error instanceof Error ? error.message : String(error)}`)
    })
    this.chains.set(accountId, settled)
    return settled
  }

  private async settle(accountId: string): Promise<void> {
    await this.context.queue.notify()
    await this.flush(accountId)
  }
}
