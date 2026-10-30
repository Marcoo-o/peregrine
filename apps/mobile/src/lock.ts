import type { SqlDb } from '@peregrine/core/sqlDb'

/** The screen lock of the device, which is the lock of the application. The native module is behind it. */
export interface DeviceLock {
  /** Whether the device has a screen lock at all. Without one the application cannot be locked. */
  available(): Promise<boolean>
  /** Asks the user for it: true when it was given, false when they cancelled or there is none. */
  authenticate(title: string, description: string): Promise<boolean>
  /** Keeps what the application shows out of screenshots and the list of recent applications, or not. */
  setSecure(on: boolean): Promise<void>
}

/** What the user set about locking the application. */
export interface LockSettings {
  enabled: boolean
  /** How long the application may be away before it asks again, in seconds. 0 asks every time it comes back. */
  afterSeconds: number
}

/** The times to choose from: at once, a minute, five, fifteen. */
export const LOCK_DELAYS = [0, 60, 300, 900] as const

export const DEFAULT_LOCK: LockSettings = { enabled: false, afterSeconds: 60 }

const NAME = 'lock'

/** The settings as stored, with what is missing or is not one of the choices taking its default. */
export async function loadLock(db: SqlDb): Promise<LockSettings> {
  const row = await db.get<{ value: string }>('SELECT value FROM settings WHERE name = ?', NAME)
  if (!row) return DEFAULT_LOCK
  try {
    const given = (JSON.parse(row.value) as Record<string, unknown> | null) ?? {}
    const known = (LOCK_DELAYS as readonly number[]).includes(given.afterSeconds as number)
    return {
      enabled: given.enabled === true,
      afterSeconds: known ? (given.afterSeconds as number) : DEFAULT_LOCK.afterSeconds
    }
  } catch {
    return DEFAULT_LOCK
  }
}

export async function saveLock(db: SqlDb, change: Partial<LockSettings>): Promise<LockSettings> {
  const next = { ...(await loadLock(db)), ...change }
  await db.run(
    `INSERT INTO settings (name, value) VALUES (?, ?)
     ON CONFLICT (name) DO UPDATE SET value = excluded.value`,
    NAME,
    JSON.stringify(next)
  )
  return next
}

/**
 * Whether the application is to be locked now: when it is on, and when it came back after being away for as long as was set or longer. Never
 * having been away is not a reason, and neither is a clock that went back (a negative time away counts as no time).
 */
export function mustLock(settings: LockSettings, leftAt: number | null, now: number): boolean {
  if (!settings.enabled || leftAt === null) return false
  return Math.max(0, now - leftAt) >= settings.afterSeconds * 1000
}

/** The words for a time. */
export function delayLabel(seconds: number): string {
  if (seconds === 0) return 'Sofort'
  return seconds < 60 ? `${seconds} Sekunden` : `${seconds / 60} Minuten`
}
