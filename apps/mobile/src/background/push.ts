import type { SqlDb } from '@peregrine/core/sqlDb'
import { listAccounts, type Account } from '../accounts'
import { describeError } from '../errors'
import { loadNotificationSettings } from '../settings'
import type { PushDevice, PushSource } from './devices'

/** What the push service is told for an account, or undefined when it cannot watch it: it only takes connections that are encrypted. */
export function pushSourceOf(account: Account): PushSource | undefined {
  if (account.imapSecure === 'none') return undefined
  return {
    sourceId: account.id,
    host: account.imapHost,
    port: account.imapPort,
    security: account.imapSecure,
    username: account.imapUsername,
    password: account.password,
    mailbox: 'INBOX'
  }
}

export interface PushDeps {
  db: SqlDb
  push: PushDevice
  log: { error(message: string): void }
}

/**
 * Tells the push service of the system what to watch: the inbox of each account that notifications are on for, and
 * nothing when they are off. The service wakes the application when something happens there, and the look that
 * follows decides what is worth a notification, in quiet hours as well, so the quiet hours are not the business of
 * the service. Where the device has no push service this does nothing and the schedule of the platform is all there is.
 *
 * Idempotent: a registration that is the same again changes nothing in the service, so it is run at every start and
 * after everything that could change it, and it does not mean a new connection each time.
 *
 * Nothing in it raises. A service that cannot be told is logged, and the schedule still looks.
 */
export async function applyPush(deps: PushDeps): Promise<void> {
  const { db, push, log } = deps
  try {
    if (!(await push.available())) return
    const settings = await loadNotificationSettings(db)
    if (!settings.enabled) {
      await push.unregisterAll()
      return
    }
    for (const account of await listAccounts(db)) {
      const source = settings.mutedAccountIds.includes(account.id) ? undefined : pushSourceOf(account)
      if (source) await push.register(source)
      else await push.unregister(account.id)
    }
  } catch (error) {
    log.error(`the push service could not be told: ${describeError(error)}`)
  }
}

/** Takes an account out of the push service, for an account that is removed. Not an error when there is none or it does not answer. */
export async function forgetPush(deps: Pick<PushDeps, 'push' | 'log'>, accountId: string): Promise<void> {
  try {
    if (await deps.push.available()) await deps.push.unregister(accountId)
  } catch (error) {
    deps.log.error(`the push service could not be told: ${describeError(error)}`)
  }
}
