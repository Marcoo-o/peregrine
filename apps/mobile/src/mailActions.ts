import type { ImapSession } from '@peregrine/core/imapSession'
import type { QueueRunner } from '@peregrine/core/offlineQueue'
import {
  discardFailedActions,
  dropQueuedDraftSaves,
  dropQueuedMoves,
  enqueueAction,
  listAllActions,
  listPendingActions,
  listScheduled,
  pendingSummary,
  queuedDraftSave,
  removePendingAction
} from '@peregrine/core/pendingActionsStore'
import type { PendingSummary } from '@peregrine/core/pendingActions'
import type { SqlDb } from '@peregrine/core/sqlDb'
import type { ComposeInput } from '@peregrine/core/types'
import { getFolderBySpecialUse, type Folder } from './folders'
import { applyFlags, deleteMessages, setPendingMove } from './messages'

/** What is told when a draft that waited in the queue has been kept: which writing of a message it is of, and where it is. */
export type DraftKeptListener = (draftKey: string, kept: { folder: Folder; uid: number | null }) => void

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
  private readonly keptListeners = new Set<DraftKeptListener>()

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
  async send(input: ComposeInput, options: { holdSeconds?: number; at?: number } = {}): Promise<number> {
    const hold = options.holdSeconds ?? 0
    // A moment that was chosen is the one it goes at; without one it is held for the time to take it back, or goes at once.
    const dueAt = options.at !== undefined && options.at > Date.now() ? options.at : hold > 0 ? Date.now() + hold * 1000 : null
    const id = await enqueueAction(this.context.db, input.accountId, 'send', { input }, dueAt)
    await this.settle(input.accountId)
    return id
  }

  /** The messages that wait for a moment that is still ahead, the next first: those that were scheduled and those that can still be taken back. */
  async scheduledSends(): Promise<Array<{ id: number; accountId: string; dueAt: number; input: ComposeInput }>> {
    const now = Date.now()
    const found: Array<{ id: number; accountId: string; dueAt: number; input: ComposeInput }> = []
    for (const action of await listScheduled(this.context.db)) {
      if (action.kind !== 'send' || action.dueAt === null || action.dueAt <= now) continue
      found.push({ id: action.id, accountId: action.accountId, dueAt: action.dueAt, input: (action.payload as { input: ComposeInput }).input })
    }
    return found
  }

  /**
   * Takes a message that is held back out of the queue, and says whether it did. It does while the moment it was held until is still
   * ahead; from then on it is an action like any other, which may be under way, and a message that went out cannot be taken back.
   * Raises nothing for what is not there: that is the same as too late.
   */
  async cancelSend(actionId: number): Promise<boolean> {
    const { db } = this.context
    const held = (await listAllActions(db)).find((action) => action.id === actionId)
    if (!held || held.kind !== 'send' || held.dueAt === null || held.dueAt <= Date.now()) return false
    await removePendingAction(db, actionId)
    await this.context.queue.notify()
    return true
  }

  /**
   * Keeps the draft of a writing of a message on the server, now when there is a connection and when there is one when
   * there is not. A revision that is still waiting from before is taken out: it is the older of the two, and the draft
   * is kept once, as it is when the connection comes. `replace` is the revision that was kept before.
   */
  async keepDraft(input: ComposeInput, draftKey: string, replace?: { folderId: string; uid: number }): Promise<void> {
    const waiting = await dropQueuedDraftSaves(this.context.db, input.accountId, draftKey)
    await enqueueAction(this.context.db, input.accountId, 'saveDraft', { draftKey, input, replace: waiting?.replace ?? replace })
    await this.settle(input.accountId)
  }

  /**
   * Takes the draft of a writing of a message out of the queue, for a message that is sent or thrown away and has
   * nothing to be kept for. The revision it would have replaced is still on the server, and the caller knows where, and
   * has it deleted.
   */
  async forgetDraft(accountId: string, draftKey: string): Promise<void> {
    await dropQueuedDraftSaves(this.context.db, accountId, draftKey)
  }

  /** Whether the draft of a writing of a message waits to be kept, and why its last attempt failed, if it did. */
  async draftState(accountId: string, draftKey: string): Promise<{ waiting: boolean; error: string | null }> {
    const queued = await queuedDraftSave(this.context.db, accountId, draftKey)
    return { waiting: queued !== undefined, error: queued?.lastError ?? null }
  }

  /** Calls the listener whenever a draft that was in the queue has been kept, with where it is. */
  onDraftKept(listener: DraftKeptListener): () => void {
    this.keptListeners.add(listener)
    return () => this.keptListeners.delete(listener)
  }

  /** Said by the handler that keeps queued drafts, once one is kept. */
  draftKept(draftKey: string, kept: { folder: Folder; uid: number | null }): void {
    for (const listener of this.keptListeners) listener(draftKey, kept)
  }

  /** What waits, for a line on a screen: how many, and how many were given up on. */
  waiting(): Promise<PendingSummary> {
    return pendingSummary(this.context.db)
  }

  /** Why the first action that failed, of an account, failed. Null when none has. */
  async lastProblem(accountId: string): Promise<string | null> {
    const actions = await listPendingActions(this.context.db, accountId)
    return actions.find((action) => action.lastError !== null)?.lastError ?? null
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
    await this.armDue()
  }

  /**
   * Has the queue wake up when the next action that is held back for a moment becomes due, which is a message that can still be taken
   * back. Without it such an action would only go at the next time something runs the queue, which for a phone that stays connected can
   * be never. One timer for everything, armed again after each change and each time it fires. Called by whatever changes the queue and when
   * the application starts, since the actions that were held when it was closed are due when it is opened again.
   */
  async armDue(): Promise<void> {
    await this.context.queue.rescheduleDue(() => void this.flushScheduled())
  }

  /** Runs the queue of every account that has an action that is held back, the due ones among them going out. */
  private async flushScheduled(): Promise<void> {
    const accountIds = new Set((await listScheduled(this.context.db)).map((action) => action.accountId))
    await Promise.all([...accountIds].map((accountId) => this.flush(accountId)))
  }
}
