import type { SqlDb } from '@peregrine/core/sqlDb'
import { listAllIdentities, type Identity } from '../identities'

/**
 * The identities of every account, read once and asked many times: a message is started without waiting for the database, so
 * what it needs to know of the sender is kept here. Whatever changes an identity calls `load` again.
 */
export class Identities {
  private byAccount = new Map<string, Identity[]>()

  constructor(private readonly db: SqlDb) {}

  /** Reads the identities. Called when the application starts and whenever one is added, changed or taken away. */
  async load(): Promise<void> {
    const byAccount = new Map<string, Identity[]>()
    for (const identity of await listAllIdentities(this.db)) {
      byAccount.set(identity.accountId, [...(byAccount.get(identity.accountId) ?? []), identity])
    }
    this.byAccount = byAccount
  }

  /** The identities of an account, the default first. */
  forAccount(accountId: string): Identity[] {
    return this.byAccount.get(accountId) ?? []
  }

  /** The identity a new message of the account starts from, or undefined for an account that has none. */
  defaultFor(accountId: string): Identity | undefined {
    return this.forAccount(accountId)[0]
  }
}
