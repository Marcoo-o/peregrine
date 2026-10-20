import { parseTimeOfDay, type NotificationPolicy } from '@peregrine/core/notificationPolicy'
import type { SqlDb } from '@peregrine/core/sqlDb'

/**
 * What the user has set about notifications, the same things the desktop has: whether there are any,
 * whether they say who wrote and what about, which accounts stay silent, and the hours in which nothing
 * may pop up. And one more that only a phone has: how often it looks for mail while the application is
 * closed.
 */
export interface NotificationSettings {
  /** Off until the user switches it on, because switching it on is also where the permission is asked for. */
  enabled: boolean
  /** Sender and subject, or only that something arrived. What a stranger looking at the screen learns. */
  preview: boolean
  /** `HH:MM`; both empty switches quiet hours off. */
  quietFrom: string
  quietTo: string
  /** Accounts that stay silent. Opt-out, so an account added later notifies by default. */
  mutedAccountIds: string[]
  /** How often to look for mail in the background. The platform does not go below fifteen minutes. */
  intervalMinutes: number
}

/** The intervals the user can choose between, in minutes. Fifteen is the least the platform allows. */
export const INTERVAL_CHOICES = [15, 30, 60, 120, 240] as const

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: false,
  preview: true,
  quietFrom: '',
  quietTo: '',
  mutedAccountIds: [],
  intervalMinutes: 30
}

const NOTIFICATIONS = 'notifications'

/** The quiet hours a switch writes when it is turned on, the usual night, as the desktop does. */
export const DEFAULT_QUIET_HOURS = { quietFrom: '22:00', quietTo: '07:00' }

/** Whether the quiet hours are on: a window with both ends. */
export function hasQuietHours(settings: Pick<NotificationSettings, 'quietFrom' | 'quietTo'>): boolean {
  return settings.quietFrom !== '' && settings.quietTo !== ''
}

function timeOrEmpty(value: unknown): string {
  return typeof value === 'string' && parseTimeOfDay(value) !== null ? value.trim() : ''
}

/**
 * Settings read back from storage, with every field checked: what is missing or is not what it should
 * be takes the value it has by default, and an interval that is not one of the choices takes the nearest
 * one that is not shorter than what was stored, so that it never looks more often than was asked.
 */
function sanitize(stored: unknown): NotificationSettings {
  const given = typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {}
  const defaults = DEFAULT_NOTIFICATION_SETTINGS
  const interval = typeof given.intervalMinutes === 'number' ? given.intervalMinutes : defaults.intervalMinutes
  const quietFrom = timeOrEmpty(given.quietFrom)
  const quietTo = timeOrEmpty(given.quietTo)
  const quiet = quietFrom !== '' && quietTo !== ''
  return {
    enabled: typeof given.enabled === 'boolean' ? given.enabled : defaults.enabled,
    preview: typeof given.preview === 'boolean' ? given.preview : defaults.preview,
    // Half a window is no window.
    quietFrom: quiet ? quietFrom : '',
    quietTo: quiet ? quietTo : '',
    mutedAccountIds: Array.isArray(given.mutedAccountIds)
      ? given.mutedAccountIds.filter((id): id is string => typeof id === 'string')
      : defaults.mutedAccountIds,
    intervalMinutes: INTERVAL_CHOICES.find((choice) => choice >= interval) ?? INTERVAL_CHOICES[INTERVAL_CHOICES.length - 1]
  }
}

export async function loadNotificationSettings(db: SqlDb): Promise<NotificationSettings> {
  const row = await db.get<{ value: string }>('SELECT value FROM settings WHERE name = ?', NOTIFICATIONS)
  if (!row) return DEFAULT_NOTIFICATION_SETTINGS
  try {
    return sanitize(JSON.parse(row.value))
  } catch {
    // A value that is not JSON is as good as none.
    return DEFAULT_NOTIFICATION_SETTINGS
  }
}

/** Changes some of the settings and returns all of them as they are stored now. */
export async function saveNotificationSettings(
  db: SqlDb,
  change: Partial<NotificationSettings>
): Promise<NotificationSettings> {
  const next = sanitize({ ...(await loadNotificationSettings(db)), ...change })
  await db.run(
    `INSERT INTO settings (name, value) VALUES (?, ?)
     ON CONFLICT (name) DO UPDATE SET value = excluded.value`,
    NOTIFICATIONS,
    JSON.stringify(next)
  )
  return next
}

/** What the desktop's rule for when a notification may appear is given. */
export function policyOf(settings: NotificationSettings): NotificationPolicy {
  return {
    enabled: settings.enabled,
    mutedAccountIds: settings.mutedAccountIds,
    quietFrom: settings.quietFrom,
    quietTo: settings.quietTo
  }
}

