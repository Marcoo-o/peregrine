import { shouldNotify } from '@peregrine/core/notificationPolicy'
import { listAccounts } from '../accounts'
import { describeError } from '../errors'
import type { Log, Services } from '../app/services'
import { loadNotificationSettings, policyOf } from '../settings'
import { refreshInboxes } from '../unified'
import { inboxBaselines, newMessagesSince } from './newMail'
import { buildNotifications, type MailNotification, type Notifier } from './notifications'

export interface BackgroundSyncDeps {
  services: Pick<Services, 'db' | 'connections' | 'mail'>
  notifier: Notifier
  /** Whether the application is on the screen, in which case it brings itself up to date and this does not. */
  isForeground(): boolean
  log: Log
  now?: () => Date
}

export interface BackgroundSyncResult {
  /** Why nothing was done, or undefined when something was. */
  skipped?: 'disabled' | 'foreground' | 'nothing to do'
  /** The accounts that were brought up to date, and the accounts that could not be. */
  synced: number
  failed: number
  /** The notifications that were shown. */
  notified: number
}

const NOTHING = { synced: 0, failed: 0, notified: 0 }

/**
 * Looks for new mail while the application is closed, and says so in a notification.
 *
 * It is what the platform's scheduler runs every so often, and it does what the application does when
 * it is opened on its own: it replays what was decided offline, takes the folders and the inbox of each
 * account, and then looks at what came in. Only the accounts that would be told about it are brought up
 * to date, and not at all in the quiet hours: a connection that cannot lead to a notification is battery
 * spent for nothing, and opening the application brings the rest up to date anyway.
 *
 * What is new is what has a higher UID than the inbox had before, and is not read. So a message that the
 * user saw in the application is not announced afterwards, and one is announced once.
 */
export async function runBackgroundSync(deps: BackgroundSyncDeps): Promise<BackgroundSyncResult> {
  const { services, notifier, log } = deps
  const now = (deps.now ?? (() => new Date()))()
  const settings = await loadNotificationSettings(services.db)
  if (!settings.enabled) return { skipped: 'disabled', ...NOTHING }
  if (deps.isForeground()) return { skipped: 'foreground', ...NOTHING }

  const policy = policyOf(settings)
  const accounts = (await listAccounts(services.db)).filter((account) => shouldNotify(policy, account.id, now))
  if (accounts.length === 0) return { skipped: 'nothing to do', ...NOTHING }

  try {
    const baselines = await inboxBaselines(services.db)
    const results = await refreshInboxes(services, accounts)
    const failed = results.filter((result) => result.error !== undefined)
    for (const result of failed) log.warn(`${result.accountName} could not be brought up to date: ${result.error}`)

    const notifications = buildNotifications(await newMessagesSince(services.db, baselines), settings, now)
    let notified = 0
    for (const notification of notifications) if (await show(notifier, notification, log)) notified += 1
    return { synced: results.length - failed.length, failed: failed.length, notified }
  } finally {
    // The connections were made for this run. Nothing is waiting to use them, and the platform stops
    // the process when it likes.
    services.connections.dropAll()
  }
}

/** Shows a notification. One that cannot be shown is logged and does not keep the others from being shown. */
async function show(notifier: Notifier, notification: MailNotification, log: Log): Promise<boolean> {
  try {
    await notifier.show(notification)
    return true
  } catch (error) {
    log.error(`a notification could not be shown: ${describeError(error)}`)
    return false
  }
}
