/**
 * When a new-mail notification may appear.
 *
 * The decision lives here rather than in the AccountManager because it is the part with
 * cases: a muted account, the hours in which nothing may pop up, and the wrap around
 * midnight that every naive time comparison gets wrong.
 */

export interface NotificationPolicy {
  enabled: boolean
  /** Accounts that stay silent. Opt-out, so an account added later notifies by default. */
  mutedAccountIds: string[]
  /** `HH:MM`; both empty switches quiet hours off. */
  quietFrom: string
  quietTo: string
}

export function parseMutedAccounts(raw: string | undefined): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

export function serializeMutedAccounts(accountIds: string[]): string {
  return JSON.stringify(accountIds)
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

/** Minutes since midnight, or null when the value is not a time. */
export function parseTimeOfDay(value: string | undefined): number | null {
  const match = TIME.exec((value ?? '').trim())
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

/**
 * Whether `now` falls into the quiet window.
 *
 * The interesting case is the one people actually configure: 22:00 to 07:00 runs across
 * midnight, so the window is "at or after the start OR before the end". The opposite of the
 * ordinary between-check, and the reason this is not written inline.
 *
 * The start is inclusive and the end exclusive, so 22:00-07:00 and 07:00-22:00 together
 * cover the day exactly once and leave no minute in both windows.
 */
export function isQuietTime(now: Date, quietFrom: string, quietTo: string): boolean {
  const from = parseTimeOfDay(quietFrom)
  const to = parseTimeOfDay(quietTo)
  if (from === null || to === null) return false
  // Equal bounds would mean an empty window, not a silent day: a setting that silences
  // everything for good is one nobody chooses on purpose.
  if (from === to) return false
  const minutes = now.getHours() * 60 + now.getMinutes()
  return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to
}

export function shouldNotify(policy: NotificationPolicy, accountId: string, now: Date): boolean {
  if (!policy.enabled) return false
  if (policy.mutedAccountIds.includes(accountId)) return false
  return !isQuietTime(now, policy.quietFrom, policy.quietTo)
}
