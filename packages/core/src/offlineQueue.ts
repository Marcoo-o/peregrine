import type { ImapSession } from './imapSession'
import type {
  PendingAction,
  PendingDeletePayload,
  PendingFlagsPayload,
  PendingMovePayload,
  PendingSendPayload
} from './pendingActions'
import type { ComposeInput } from './types'

/** Where the actions are kept. The desktop keeps them in its database, the phone in its own. */
export interface QueueStore {
  /** The actions of one account, in the order they are to run. */
  list(accountId: string): Promise<PendingAction[]>
  remove(id: number): Promise<void>
  /** Counts a failed attempt and keeps the reason. Giving up after too many is the store's business. */
  recordFailure(id: number, message: string): Promise<void>
  /** When the next scheduled action is due, or null when none waits for a moment. */
  nextDueAt(): Promise<number | null>
}

/** What the queue has to know about, and do to, the mail on this device. */
export interface QueueLocalMail {
  /** The path of a folder on the server, or null when there is no such folder any more. */
  folderPath(folderId: string): Promise<string | null>
  /** After the server has moved messages: the rows they left behind in the source folder go. */
  forgetMoved(sourceFolderId: string, uids: number[]): Promise<void>
  /** A move that will never happen: the mark on the messages that said one was coming goes. */
  clearMoveMark(sourceFolderId: string, uids: number[]): Promise<void>
}

export interface QueueTimers {
  set(run: () => void, delayMs: number): unknown
  clear(handle: unknown): void
}

export interface QueueEnvironment {
  /** Called after anything about the queue changed, so that a screen can show what waits. */
  changed(): Promise<void>
  log: { warn(message: string): void; error(message: string): void }
  /** Defaults to Date.now. */
  now?: () => number
  /** How long one action may take. Defaults to two and a half minutes. */
  actionTimeoutMs?: number
  /** Defaults to the platform's own. */
  timers?: QueueTimers
}

/**
 * How long one queued action may take.
 *
 * Generous, because a message with a large attachment legitimately needs a while. But finite,
 * because this runs inside the account start: an action that never finishes takes the connection,
 * the background sync and IDLE down with it.
 */
export const ACTION_TIMEOUT_MS = 150_000

/** `setTimeout` keeps its delay in a 32-bit integer and fires at once past about 24 days. */
const MAX_DELAY_MS = 24 * 3600_000

const platformTimers: QueueTimers = {
  set(run, delayMs) {
    const handle = setTimeout(run, delayMs) as { unref?: () => void } | undefined
    // A timer that only waits for a queue must not keep a process alive that has nothing else to do.
    handle?.unref?.()
    return handle
  },
  clear(handle) {
    // The handle is whatever `set` returned. Its type depends on the platform, so it is named by
    // what `clearTimeout` takes there.
    clearTimeout(handle as Parameters<typeof clearTimeout>[0])
  }
}

/**
 * Replays what was done while there was no connection.
 *
 * Two rules carry the whole thing:
 *
 * **Order is preserved, per account.** Marking as read and then moving is not the same as moving
 * and then marking as read. The second one would touch a UID that no longer exists in that folder.
 * So the actions of an account run one after another, and the first failure stops that account's
 * run rather than skipping ahead.
 *
 * **A target that is gone is not an error.** A folder that no longer exists means the action has
 * nothing left to act on: it is dropped rather than retried, because retrying would block
 * everything behind it forever. A single UID that has disappeared is not detectable this way since
 * most servers treat it as a no-op, and for the few that complain the attempt cap ends it after a
 * few connections instead of never.
 *
 * It knows nothing of where it runs. What it needs comes in through `QueueStore`, `QueueLocalMail`
 * and `QueueEnvironment`, so the desktop and the phone replay by the same rules.
 */
export class QueueRunner {
  /** Accounts currently being replayed, so a second connection event cannot double-run one. */
  private running = new Set<string>()
  /**
   * Sending lives in a module that is registered after this one exists, so it is handed in rather
   * than known. Without it a queued message simply waits.
   */
  private send: ((input: ComposeInput) => Promise<unknown>) | null = null
  /** Fires when the next scheduled message becomes due. */
  private dueTimer: unknown = null
  private readonly timers: QueueTimers
  private readonly now: () => number

  constructor(
    private readonly store: QueueStore,
    private readonly local: QueueLocalMail,
    private readonly env: QueueEnvironment
  ) {
    this.timers = env.timers ?? platformTimers
    this.now = env.now ?? Date.now
  }

  setSendHandler(send: (input: ComposeInput) => Promise<unknown>): void {
    this.send = send
  }

  /**
   * Wakes up when the next scheduled message is due.
   *
   * The queue itself only runs when a connection comes up, which is right for something that was
   * waiting for one. But a message meant for Monday at eight has to go out on Monday at eight, not
   * at the next reconnect. One timer for the whole mailbox, re-armed after every change, with a
   * day-long cap.
   */
  async rescheduleDue(runFlush: () => void): Promise<void> {
    this.disarm()

    const due = await this.store.nextDueAt()
    // Cleared once more: another call can have armed a timer while this one was reading, and
    // overwriting the field would leave that one running with nothing able to stop it.
    this.disarm()
    if (due === null) return

    // A second of slack, so the row is unambiguously due when the queue reads it rather than due
    // in the same millisecond the comparison runs.
    const delay = Math.min(Math.max(due - this.now(), 0) + 1000, MAX_DELAY_MS)
    this.dueTimer = this.timers.set(() => {
      this.dueTimer = null
      runFlush()
      void this.rescheduleDue(runFlush).catch((error) => {
        this.env.log.error(`rescheduling the due timer failed: ${messageOf(error)}`)
      })
    }, delay)
  }

  stop(): void {
    this.disarm()
  }

  /** Tells whoever shows the queue that something changed. */
  async notify(): Promise<void> {
    await this.env.changed()
  }

  async flush(accountId: string, imap: ImapSession): Promise<void> {
    if (this.running.has(accountId)) return
    this.running.add(accountId)
    try {
      for (const action of await this.store.list(accountId)) {
        try {
          // Every action gets a deadline. Without one a single hanging command holds the whole
          // queue, and the connection it runs on, for good. A send to an unreachable server never
          // settled, and everything behind it waited with it. A timeout counts as a failed
          // attempt, which is what it is.
          const done = await this.withTimeout(this.perform(action, imap), action.kind)
          await this.store.remove(action.id)
          if (!done) {
            this.env.log.warn(`pending action ${action.id} (${action.kind}) had nothing left to act on and was dropped`)
          }
        } catch (error) {
          const message = messageOf(error)
          await this.store.recordFailure(action.id, message)
          this.env.log.error(`replaying pending action ${action.id} failed: ${message}`)
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
   * Carries out one action. Returns false when there was nothing left to act on, which is a reason
   * to drop it rather than to retry.
   */
  private async perform(action: PendingAction, imap: ImapSession): Promise<boolean> {
    if (action.kind === 'flags') {
      const payload = action.payload as PendingFlagsPayload
      const path = await this.local.folderPath(payload.folderId)
      if (path === null || payload.uids.length === 0) return false
      for (const uid of payload.uids) {
        if (payload.add.length > 0) await imap.addFlags(path, uid, payload.add)
        if (payload.remove.length > 0) await imap.removeFlags(path, uid, payload.remove)
      }
      return true
    }

    if (action.kind === 'send') {
      const payload = action.payload as PendingSendPayload
      // Raised rather than returned. `false` here means "nothing left to act on", and the caller
      // drops the row on it, so a message would have disappeared unsent. A missing handler says the
      // opposite: this cannot run *yet*. The compose module registers it before any account
      // starts, so today this is unreachable, and the only thing making it so is that order. A
      // queued message must not depend on it.
      if (!this.send) throw new Error('nothing to send with yet: no send handler registered')
      // Sent first, removed from the queue afterwards. The other order would lose a message if
      // the application stopped in between, and a message the user considers sent must not
      // disappear. The price is the reverse window. A crash after the server accepted the mail
      // but before the row is gone would send it twice on the next start.
      await this.send({ ...payload.input, sendNow: true })
      return true
    }

    if (action.kind === 'move') {
      const payload = action.payload as PendingMovePayload
      const source = await this.local.folderPath(payload.sourceFolderId)
      const target = await this.local.folderPath(payload.targetFolderId)
      if (source === null || target === null || payload.uids.length === 0) {
        // Nothing will carry these messages away any more, so the mark has to go: it only ever
        // meant "a queued move is coming".
        await this.local.clearMoveMark(payload.sourceFolderId, payload.uids)
        return false
      }
      await imap.moveMessages(source, target, payload.uids)
      // Only now, once the server has actually been told. Until this line the rows were right
      // where they claimed to be; from here the target folder owns the message and fills it in
      // under its real UID on the next sync.
      await this.local.forgetMoved(payload.sourceFolderId, payload.uids)
      return true
    }

    const payload = action.payload as PendingDeletePayload
    const path = await this.local.folderPath(payload.folderId)
    if (path === null || payload.uids.length === 0) return false
    await imap.deleteMessages(path, payload.uids)
    return true
  }

  private disarm(): void {
    if (this.dueTimer !== null) this.timers.clear(this.dueTimer)
    this.dueTimer = null
  }

  private withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
    const ms = this.env.actionTimeoutMs ?? ACTION_TIMEOUT_MS
    return new Promise<T>((resolve, reject) => {
      const timer = this.timers.set(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
      promise.then(
        (value) => {
          this.timers.clear(timer)
          resolve(value)
        },
        (error) => {
          this.timers.clear(timer)
          reject(error)
        }
      )
    })
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
