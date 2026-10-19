import { describe, expect, it } from 'vitest'
import { formatBytes, formatFullDate, formatListDate, initialFor } from './format'

describe('formatBytes', () => {
  it('renders nothing for missing or zero sizes', () => {
    expect(formatBytes(0, 'de')).toBe('')
    expect(formatBytes(-1, 'de')).toBe('')
  })

  it('scales into the largest fitting unit', () => {
    expect(formatBytes(512, 'en')).toBe('512 B')
    expect(formatBytes(2048, 'en')).toBe('2 KB')
    expect(formatBytes(5 * 1024 * 1024, 'en')).toBe('5 MB')
  })

  it('keeps one decimal below ten of a scaled unit', () => {
    expect(formatBytes(1536, 'en')).toBe('1.5 KB')
    // At and above ten the decimal stops carrying information for a size column.
    expect(formatBytes(20 * 1024, 'en')).toBe('20 KB')
  })
})

describe('formatListDate', () => {
  it('returns an empty string for missing or unparsable input', () => {
    expect(formatListDate('', 'de')).toBe('')
    expect(formatListDate('not a date', 'de')).toBe('')
  })

  it('shows only the time for messages from today', () => {
    const today = new Date()
    today.setHours(9, 5, 0, 0)
    const formatted = formatListDate(today.toISOString(), 'de')
    expect(formatted).not.toContain('.')
    expect(formatted).toMatch(/\d{2}:\d{2}/)
  })

  it('includes the date for older messages', () => {
    const older = new Date('2020-03-04T10:00:00.000Z')
    expect(formatListDate(older.toISOString(), 'de')).toContain('20')
  })
})

describe('formatFullDate', () => {
  it('returns an empty string for unparsable input', () => {
    expect(formatFullDate('nope', 'de')).toBe('')
  })
})

describe('initialFor', () => {
  it('prefers the display name over the address', () => {
    expect(initialFor('Andreas', 'info@example.org')).toBe('A')
  })

  it('falls back to the address and finally to a placeholder', () => {
    expect(initialFor('', 'info@example.org')).toBe('I')
    expect(initialFor('', '')).toBe('?')
  })
})
