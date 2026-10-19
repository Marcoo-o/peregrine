/**
 * When a recurring task is due, and which day "today" is.
 *
 * Rules are stored, occurrences are computed. Writing a row for every future day is how
 * to-do lists rot: the table grows without being read, and someone has to clean it up. The
 * same principle already carries the snooze. Expiry needs no job, because the question is
 * answered from the rule and the clock.
 *
 * Everything here works on calendar dates, never on epoch arithmetic. A day is not 86 400
 * seconds twice a year, and "every day at 8" must not drift by an hour in October.
 */

export type Recurrence =
  | { kind: 'once' }
  | { kind: 'daily' }
  /** Monday to Friday. */
  | { kind: 'weekdays' }
  /** `weekday` follows Date#getDay: 0 is Sunday. */
  | { kind: 'weekly'; weekday: number }
  /** `day` may be 29, 30 or 31; short months fall back to their last day. */
  | { kind: 'monthly'; day: number }

const WEEKLY = /^weekly:([0-6])$/
const MONTHLY = /^monthly:(3[01]|[12]?[0-9])$/

/**
 * Reads a stored rule. Anything unrecognised becomes a one-off rather than being dropped:
 * a task whose rule cannot be read should still appear once, not vanish.
 */
export function parseRecurrence(raw: string | undefined | null): Recurrence {
  const value = (raw ?? '').trim().toLowerCase()
  if (value === 'daily') return { kind: 'daily' }
  if (value === 'weekdays') return { kind: 'weekdays' }

  const weekly = WEEKLY.exec(value)
  if (weekly) return { kind: 'weekly', weekday: Number(weekly[1]) }

  const monthly = MONTHLY.exec(value)
  if (monthly) {
    const day = Number(monthly[1])
    if (day >= 1 && day <= 31) return { kind: 'monthly', day }
  }
  return { kind: 'once' }
}

export function serializeRecurrence(rule: Recurrence): string {
  switch (rule.kind) {
    case 'daily':
      return 'daily'
    case 'weekdays':
      return 'weekdays'
    case 'weekly':
      return `weekly:${rule.weekday}`
    case 'monthly':
      return `monthly:${rule.day}`
    case 'once':
      return 'once'
  }
}

/** `YYYY-MM-DD` in local time. `toISOString` would silently shift the date by the offset. */
export function toDayKey(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function fromDayKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  // Rejects 2026-02-31, which the Date constructor would happily roll into March.
  return toDayKey(date) === key ? date : null
}

/**
 * Which day the list is showing.
 *
 * Not simply the calendar date: someone still working at one in the morning is having
 * yesterday, and a list that empties itself at midnight in front of them is wrong. The start
 * hour moves the boundary; 0 gives plain calendar days.
 */
export function currentDayKey(now: Date, dayStartHour: number): string {
  const shifted = new Date(now)
  if (now.getHours() < dayStartHour) shifted.setDate(shifted.getDate() - 1)
  return toDayKey(shifted)
}

/** The last day of the month `date` falls in. */
function lastDayOfMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
}

/**
 * Whether a rule puts the task on this day.
 *
 * `startKey` is the day the task was created: a rule does not reach into the past, or every
 * new weekly task would arrive already overdue for every week since the epoch.
 */
export function occursOn(rule: Recurrence, dayKey: string, startKey: string): boolean {
  const day = fromDayKey(dayKey)
  if (!day || dayKey < startKey) return false

  switch (rule.kind) {
    case 'once':
      return dayKey === startKey
    case 'daily':
      return true
    case 'weekdays':
      return day.getDay() >= 1 && day.getDay() <= 5
    case 'weekly':
      return day.getDay() === rule.weekday
    case 'monthly':
      // "Every month on the 31st" in February means the last day, not "never". Clamping is
      // what people mean by it; skipping would drop four months of the year without a word.
      return day.getDate() === Math.min(rule.day, lastDayOfMonth(day))
  }
}

/** The next day on or after `fromKey` on which the rule applies; null if it never does. */
export function nextOccurrence(
  rule: Recurrence,
  fromKey: string,
  startKey: string
): string | null {
  if (rule.kind === 'once') return startKey >= fromKey ? startKey : null

  const start = fromDayKey(fromKey < startKey ? startKey : fromKey)
  if (!start) return null

  // A month and a day is enough for every rule here; a longer search would mean the rule
  // never matches, which the loop reports rather than hiding in an endless walk.
  for (let offset = 0; offset <= 366; offset++) {
    const candidate = new Date(start)
    candidate.setDate(candidate.getDate() + offset)
    const key = toDayKey(candidate)
    if (occursOn(rule, key, startKey)) return key
  }
  return null
}
