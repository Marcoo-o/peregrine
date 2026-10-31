import { language } from '../i18n'
import type { DateFormat } from '../appearance'


function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/**
 * A date as a list shows it, as short as it can be and still be clear: the time for what came today, the
 * day and the month for what came this year, and the whole date for what is older.
 */
export function shortDate(ms: number, now: Date, format: DateFormat = 'relative'): string {
  const date = new Date(ms)
  if (format === 'long') return date.toLocaleString(language.locale, { dateStyle: 'medium', timeStyle: 'short' })
  if (format === 'iso') {
    const two = (n: number): string => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
  }
  if (format === 'short') return date.toLocaleDateString(language.locale, { day: '2-digit', month: '2-digit', year: '2-digit' })
  if (sameDay(date, now)) return date.toLocaleTimeString(language.locale, { hour: '2-digit', minute: '2-digit' })
  if (date.getFullYear() === now.getFullYear()) return date.toLocaleDateString(language.locale, { day: 'numeric', month: 'short' })
  return date.toLocaleDateString(language.locale)
}
