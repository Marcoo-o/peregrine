import type { SqlDb } from '../db/sqlDb'
import type { WebContents } from 'electron'
import { IpcChannels } from '@shared/ipcContracts'
import type {
  PendingAction,
  PendingDeletePayload,
  PendingFlagsPayload,
  PendingMovePayload,
  PendingSendPayload
} from '@peregrine/core/pendingActions'
import type { ComposeInput } from '@peregrine/core/types'
import {
  listPendingActions,
  nextDueAt,
  pendingSummary,
  recordPendingFailure,
  removePendingAction
} from '../db/repositories/pendingActionsRepo'
import { getFolderById } from '../db/repositories/foldersRepo'
import { deleteMessages, setPendingMove } from '../db/repositories/messagesRepo'
import type { ImapSession } from '@peregrine/core/imapSession'
import { withTimeout } from '../util/withTimeout'

/**
 * How long one queued action may take.
 *
 * Generous, because a message with a large attachment legitimately needs a while. But
 * finite, because this runs inside the account start: an action that never finishes takes
 * the connection, the background sync and IDLE down with it.
 */
const ACTION_TIMEOUT_MS = 150_000

/**
 * Replays what was done while there was no connection.
 *
 * Two rules carry the whole thing:
 *
 * **Order is preserved, per account.** Marking as read and then moving is not the same as
 * moving and then marking as read. The second one would touch a UID that no longer exists
 * in that folder. So the actions of an account run one after another, and the first failure
 * stops that account's run rather than skipping ahead.
 *
 * **A target that is gone is not an error.** A folder that no longer exists means the action
 * has nothing left to act on: it is dropped rather than retried, because retrying would block
 * everything behind it forever. A single UID that has disappeared is not detectable this way
 * since most servers treat it as a no-op, and for the few that complain the attempt cap ends
 * it after five connections instead of never.
 */
export class OfflineQueue {
  /** Accounts currently being replayed, so a second connection event cannot double-run one. */
  private running = new Set<string>()
  /**
   * Sending lives in the compose module, which is registered after this one exists, so it is
   * handed in rather than imported. Without it a queued message simply waits.
   */
  private send: ((input: ComposeInput) => Promise<unknown>) | null = null
  /** Fires when the next scheduled message becomes due. */
  private dueTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly db: SqlDb,
    private readonly getWebContents: () => WebContents | undefined
  ) {}

  setSendHandler(send: (input: ComposeInput) => Promise<unknown>): void {
    this.send = send
  }

  /**
   * Wakes up when the next scheduled message is due.
   *
   * The queue itself only runs when a connection comes up, which is right for something that
   * was waiting for one. But a message meant for Monday at eight has to go out on Monday at
   * eight, not at the next reconnect. One timer for the whole mailbox, re-armed after every
   * change, with the same day-long cap as the snooze: `setTimeout` stores its delay in a
   * 32-bit int and fires immediately past about 24 days.
   */
  async rescheduleDue(runFlush: () => void): Promise<void> {
    if (this.dueTimer) clearTimeout(this.dueTimer)
    this.dueTimer = null

    const due = await nextDueAt(this.db)
    // Cleared once more: another call can have armed a timer while this one was reading, and
    // overwriting the field would leave that one running with nothing able to stop it.
    if (this.dueTimer) clearTimeout(this.dueTimer)
    this.dueTimer = null
    if (due === null) return

    const MAX_DELAY = 24 * 3600_000
    // A second of slack, so the row is unambiguously due when the queue reads it rather than
    // due in the same millisecond the comparison runs.
    const delay = Math.min(Math.max(due - Date.now(), 0) + 1000, MAX_DELAY)
    this.dueTimer = setTimeout(() => {
      this.dueTimer = null
      runFlush()
      void this.rescheduleDue(runFlush).catch((err) => {
        console.error('rescheduling the due timer failed:', err instanceof Error ? err.message : err)
      })
    }, delay)
    this.dueTimer.unref?.()
  }

  stop(): void {
    if (this.dueTimer) clearTimeout(this.dueTimer)
    this.dueTimer = null
  }

  /** Sends the current state to the renderer; called after anything changed. */
  async notify(): Promise<void> {
    this.getWebContents()?.send(IpcChannels.pendingActions, await pendingSummary(this.db))
  }

  async flush(accountId: string, imap: ImapSession): Promise<void> {
    if (this.running.has(accountId)) return
    this.running.add(accountId)
    try {
      for (const action of await listPendingActions(this.db, accountId)) {
        try {
          // Every action gets a deadline. Without one a single hanging command holds the
          // whole queue, and the connection it runs on, for good. Measured with a send to
          // an unreachable server, the promise simply never settled, and everything behind
          // it waited with it. A timeout counts as a failed attempt, which is what it is.
          const done = await withTimeout(this.perform(action, imap), ACTION_TIMEOUT_MS, action.kind)
          await removePendingAction(this.db, action.id)
          if (!done) {
            console.warn(
              `pending action ${action.id} (${action.kind}) had nothing left to act on and was dropped`
            )
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          await recordPendingFailure(this.db, action.id, message)
          console.error(`replaying pending action ${action.id} failed:`, message)
          // Stop here: everything after this one may depend on it having happened.
          break
        }
      }
    } finally {
      this.running.delete(accountId)
      await this.notify()
    }
  }

  /**
   * Carries out one action. Returns false when there was nothing left to act on, which is a
   * reason to drop it rather than to retry.
   */
  private async perform(action: PendingAction, imap: ImapSession): Promise<boolean> {
    if (action.kind === 'flags') {
      const payload = action.payload as PendingFlagsPayload
      const folder = await getFolderById(this.db, payload.folderId)
      if (!folder || payload.uids.length === 0) return false
      for (const uid of payload.uids) {
        if (payload.add.length > 0) await imap.addFlags(folder.imapPath, uid, payload.add)
        if (payload.remove.length > 0) await imap.removeFlags(folder.imapPath, uid, payload.remove)
      }
      return true
    }

    if (action.kind === 'send') {
      const payload = action.payload as PendingSendPayload
      // Raised rather than returned. `false` here means "nothing left to act on", and the
      // caller drops the row on it, so a message would have disappeared unsent. A missing
      // handler says the opposite: this cannot run *yet*. The compose module registers it
      // before any account starts, so today this is unreachable, and the only thing making it
      // so is that order. A queued message must not depend on it.
      if (!this.send) throw new Error('nothing to send with yet: no send handler registered')
      // Sent first, removed from the queue afterwards. The other order would lose a message
      // if the application stopped in between, and a message the user considers sent must
      // not disappear. The price is the reverse window. A crash after the server accepted
      // the mail but before the row is gone would send it twice on the next start.
      await this.send({ ...payload.input, sendNow: true })
      return true
    }

    if (action.kind === 'move') {
      const payload = action.payload as PendingMovePayload
      const source = await getFolderById(this.db, payload.sourceFolderId)
      const target = await getFolderById(this.db, payload.targetFolderId)
      if (!source || !target || payload.uids.length === 0) {
        // Nothing will carry these messages away any more, so the mark has to go: it only
        // ever meant "a queued move is coming".
        await setPendingMove(this.db, payload.sourceFolderId, payload.uids, null)
        return false
      }
      await imap.moveMessages(source.imapPath, target.imapPath, payload.uids)
      // Only now, once the server has actually been told. Until this line the rows were
      // right where they claimed to be; from here the target folder owns the message and
      // fills it in under its real UID on the next sync.
      await deleteMessages(this.db, payload.sourceFolderId, payload.uids)
      return true
    }

    const payload = action.payload as PendingDeletePayload
    const folder = await getFolderById(this.db, payload.folderId)
    if (!folder || payload.uids.length === 0) return false
    await imap.deleteMessages(folder.imapPath, payload.uids)
    return true
  }
}
