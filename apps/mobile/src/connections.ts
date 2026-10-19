import type { ImapSession } from '@peregrine/core/imapSession'
import type { Account } from './accounts'

/**
 * The connections of the accounts that are connected, one each.
 *
 * With one account the application could hold one connection and let go of it on leaving the account.
 * A list of every account's inbox needs all of them, and an action on a message has to reach the
 * server of the account the message is in, wherever it is shown. So the connections belong to the
 * application and not to a screen, and a screen asks for the account's, which connects if there is
 * none.
 */
export class Connections {
  private open = new Map<string, ImapSession>()
  /** A connection being made, so that two screens asking at once make one. */
  private connecting = new Map<string, Promise<ImapSession>>()

  constructor(
    private readonly connectTo: (account: Account) => Promise<ImapSession>,
    /** Called when an account is connected or lost, so that a screen can say so. */
    private readonly changed: () => void = () => undefined
  ) {}

  /** The connection of an account, or null when it has none. */
  get(accountId: string): ImapSession | null {
    return this.open.get(accountId) ?? null
  }

  get connectedIds(): string[] {
    return [...this.open.keys()]
  }

  /** The connection of an account, made if there is none. Throws, with the reason, when it cannot be made. */
  ensure(account: Account): Promise<ImapSession> {
    const have = this.open.get(account.id)
    if (have) return Promise.resolve(have)
    const pending = this.connecting.get(account.id)
    if (pending) return pending

    const attempt = this.connectTo(account)
      .then((session) => {
        this.adopt(account.id, session)
        return session
      })
      .finally(() => this.connecting.delete(account.id))
    this.connecting.set(account.id, attempt)
    return attempt
  }

  /**
   * Takes a connection that was made elsewhere as the account's. For an account that was just added:
   * the connection that proved the login is the one to keep, and not a second one.
   */
  adopt(accountId: string, session: ImapSession): void {
    const replaced = this.open.get(accountId)
    this.open.set(accountId, session)
    if (replaced && replaced !== session) replaced.disconnect().catch(() => undefined)
    session.onClose(() => {
      // Only the connection that is in use is forgotten: one that was replaced ended on purpose.
      if (this.open.get(accountId) === session) {
        this.open.delete(accountId)
        this.changed()
      }
    })
    this.changed()
  }

  /** Lets go of one account's connection. */
  drop(accountId: string): void {
    const session = this.open.get(accountId)
    if (!session) return
    this.open.delete(accountId)
    session.disconnect().catch(() => undefined)
    this.changed()
  }

  dropAll(): void {
    for (const id of this.connectedIds) this.drop(id)
  }
}
