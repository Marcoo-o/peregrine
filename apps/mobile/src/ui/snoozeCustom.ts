/** A day that can be chosen for a moment of one's own, from today on. */
export interface SnoozeDay {
  /** The start of the day. */
  start: Date
  label: string
}

/** How many days ahead can be chosen: two weeks, which is as far as a thing put aside is still a thing put aside. */
export const SNOOZE_DAYS = 14

/**
 * What is offered first: the next full hour today, and the morning of tomorrow when that is not today any more. The day is
 * given as how many days from today, which is the place of it among the days that can be chosen.
 */
export function defaultMoment(now: Date): { dayIndex: number; time: string } {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1)
  if (next.getDate() !== now.getDate()) return { dayIndex: 1, time: '08:00' }
  return { dayIndex: 0, time: `${String(next.getHours()).padStart(2, '0')}:00` }
}

const startOfDay = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), date.getDate())

/** The days that can be chosen, today first, with how each is called: today and tomorrow by name, the rest by the day. */
export function snoozeDays(now: Date, count: number = SNOOZE_DAYS): SnoozeDay[] {
  const today = startOfDay(now)
  return Array.from({ length: count }, (_, offset) => {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset)
    const label =
      offset === 0 ? 'Heute' : offset === 1 ? 'Morgen' : start.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' })
    return { start, label }
  })
}

/**
 * Reads a time of day as it is typed: `8`, `8:30`, `08:30`, `8.30` and `0830` all come to a time, and what has no hour
 * or minute in it, or has too many, does not. Returns the minutes since midnight, or undefined for what is no time.
 */
export function parseTime(text: string): number | undefined {
  const typed = text.trim()
  const match = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(typed) ?? /^(\d{2})(\d{2})$/.exec(typed)
  if (!match) return undefined
  const hours = Number(match[1])
  const minutes = match[2] === undefined ? 0 : Number(match[2])
  if (hours > 23 || minutes > 59) return undefined
  return hours * 60 + minutes
}

/** The moment of a time of day, in minutes since midnight, on a day, in epoch milliseconds. */
export function momentOn(day: Date, minutes: number): number {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60).getTime()
}

/**
 * The moment that was chosen, or why there is none: a time that is no time, or a moment that is not ahead of now, which
 * would bring the message back before it had gone.
 */
export function customMoment(
  day: Date,
  timeText: string,
  now: Date
): { ok: true; until: number } | { ok: false; reason: 'time' | 'past' } {
  const minutes = parseTime(timeText)
  if (minutes === undefined) return { ok: false, reason: 'time' }
  const until = momentOn(day, minutes)
  return until > now.getTime() ? { ok: true, until } : { ok: false, reason: 'past' }
}

/** What is said under the time when there is no moment, in the words of the sheet. */
export const CUSTOM_REASONS: Record<'time' | 'past', string> = {
  time: 'Die Uhrzeit versteht das Handy so nicht. Zum Beispiel 8:30 oder 14.15.',
  past: 'Dieser Zeitpunkt ist schon vorbei.'
}
