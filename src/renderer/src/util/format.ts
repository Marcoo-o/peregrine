import type { DateFormat } from '@peregrine/core/types'

const KILOBYTE = 1024

export function formatBytes(bytes: number, locale: string): string {
  if (!bytes || bytes <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= KILOBYTE && unit < units.length - 1) {
    value /= KILOBYTE
    unit += 1
  }
  const formatted = new Intl.NumberFormat(locale, {
    maximumFractionDigits: value < 10 && unit > 0 ? 1 : 0
  }).format(value)
  return `${formatted} ${units[unit]}`
}

/**
 * Mail clients show a time for today's mail and a date for everything older. It keeps the
 * date column narrow while still answering "when did this arrive" at a glance.
 */
/**
 * Date as it appears in the message list.
 *
 * 'relative' is the default because in a list sorted by date the year is rarely the question.
 * "Today at 14:20" answers it faster than a full date. The other formats exist for anyone who
 * would rather scan one fixed shape, and 'iso' sorts identically as text.
 */
export function formatListDate(
  iso: string,
  locale: string,
  format: DateFormat = 'relative'
): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''

  switch (format) {
    case 'iso':
      // Local time, not UTC: toISOString would silently shift the displayed time by the
      // offset, which in a mail list reads as the message having arrived at another hour.
      return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    case 'short':
      return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(date)
    case 'long':
      return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
    case 'relative':
    default: {
      const now = new Date()
      const sameDay =
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate()
      if (sameDay) {
        return new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(date)
      }
      return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(date)
    }
  }
}

export function formatFullDate(iso: string, locale: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export function initialFor(name: string, address: string): string {
  const source = name || address
  return source ? source.trim().charAt(0).toUpperCase() : '?'
}
