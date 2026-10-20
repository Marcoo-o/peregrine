const LOCALE = 'de-DE'

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/**
 * A date as a list shows it, as short as it can be and still be clear: the time for what came today, the
 * day and the month for what came this year, and the whole date for what is older.
 */
export function shortDate(ms: number, now: Date): string {
  const date = new Date(ms)
  if (sameDay(date, now)) return date.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })
  if (date.getFullYear() === now.getFullYear()) return date.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' })
  return date.toLocaleDateString(LOCALE)
}
