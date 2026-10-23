import { listPendingActions } from '@peregrine/core/pendingActionsStore'
import type { SqlDb } from '@peregrine/core/sqlDb'
import { listAccounts, type Account } from '../accounts'
import type { Connections } from '../connections'
import { describeError } from '../errors'
import type { MailActions } from '../mailActions'
import type { Log } from './services'

/** How long to wait before the next try, by how many have failed in a row. The last is kept from then on. */
export const RECONNECT_DELAYS_MS = [5_000, 15_000, 45_000, 120_000, 300_000]

export interface ReconnectTimers {
  set(run: () => void, delayMs: number): unknown
  clear(handle: unknown): void
}

const platformTimers: ReconnectTimers = {
  set: (run, delayMs) => setTimeout(run, delayMs),
  clear: (handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0])
}

/** What the accounts that have to be connected are, and how one is: asked for, so that this knows nothing of storage. */
export interface ReconnectEnvironment {
  /** The accounts that have something waiting in the queue and no connection. */
  needing(): Promise<Account[]>
  /** Connects the account and runs what waits in its queue; throws when it cannot connect. */
  connect(account: Account): Promise<void>
  log: Log
  timers?: ReconnectTimers
}

/**
 * Connects again, by itself, the accounts that have something waiting for a connection.
 *
 * A message, a draft or a change that was decided without a connection waits in the queue, and the queue runs when a
 * connection comes up. Nothing made one come up but the user opening an account or a folder, so what waited stayed
 * where it was until then. This tries on its own: after the first change that cannot go out, after a connection is
 * lost while something waits, and at once when the application comes to the front. A try that fails is repeated
 * after a longer pause each time, up to five minutes, and not at all once nothing waits: an account that nothing waits
 * for is connected when something needs it, as before, and the battery is not spent on keeping one up for nothing.
 */
export class Reconnector {
  private timer: unknown = null
  private failures = 0
  private running = false
  /** Asked for while a try was under way: another follows it, since what was asked for may have come after it looked. */
  private again = false
  private stopped = false
  private readonly timers: ReconnectTimers

  constructor(private readonly env: ReconnectEnvironment) {
    this.timers = env.timers ?? platformTimers
  }

  /** Something may need a connection: a try is made after the pause for the number of failures so far, if none is waiting. */
  schedule(): void {
    if (this.stopped || this.timer !== null) return
    const delay = RECONNECT_DELAYS_MS[Math.min(this.failures, RECONNECT_DELAYS_MS.length - 1)]
    this.timer = this.timers.set(() => {
      this.timer = null
      void this.attempt()
    }, delay)
  }

  /** The application is in front of the user: try now, and from the shortest pause again. */
  wake(): Promise<void> {
    this.failures = 0
    this.disarm()
    return this.attempt()
  }

  stop(): void {
    this.stopped = true
    this.disarm()
  }

  /** Resolves when the try that is under way, and the one that was asked for meanwhile, are done. */
  private async attempt(): Promise<void> {
    if (this.stopped) return
    if (this.running) {
      this.again = true
      return
    }
    this.running = true
    try {
      do {
        this.again = false
        await this.connectAll()
      } while (this.again && !this.stopped)
    } finally {
      this.running = false
    }
  }

  private async connectAll(): Promise<void> {
    let failed = false
    try {
      for (const account of await this.env.needing()) {
        try {
          await this.env.connect(account)
        } catch (error) {
          failed = true
          this.env.log.warn(`connecting ${account.id} again failed: ${describeError(error)}`)
        }
      }
    } catch (error) {
      failed = true
      this.env.log.error(`looking for what waits for a connection failed: ${describeError(error)}`)
    }
    if (!failed) {
      this.failures = 0
      return
    }
    this.failures += 1
    this.schedule()
  }

  private disarm(): void {
    if (this.timer !== null) this.timers.clear(this.timer)
    this.timer = null
  }
}

/** The accounts that have something waiting in the queue and are not connected. */
export async function accountsNeedingConnection(
  db: SqlDb,
  connections: Pick<Connections, 'get'>
): Promise<Account[]> {
  const needing: Account[] = []
  for (const account of await listAccounts(db)) {
    if (connections.get(account.id)) continue
    if ((await listPendingActions(db, account.id)).length > 0) needing.push(account)
  }
  return needing
}

/** The way an application connects an account again: connected, and what waits for it run. */
export function connectAndRun(connections: Pick<Connections, 'ensure'>, mail: Pick<MailActions, 'flush'>) {
  return async (account: Account): Promise<void> => {
    await connections.ensure(account)
    await mail.flush(account.id)
  }
}
