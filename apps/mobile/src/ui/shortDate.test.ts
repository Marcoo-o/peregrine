import { describe, expect, it } from 'vitest'
import { shortDate } from './shortDate'

const now = new Date(2026, 9, 20, 18, 30)

describe('a date in a list', () => {
  it('is the time for what came today', () => {
    expect(shortDate(new Date(2026, 9, 20, 7, 5).getTime(), now)).toBe('07:05')
  })

  it('is the day and the month for what came earlier this year', () => {
    expect(shortDate(new Date(2026, 9, 14, 7, 5).getTime(), now)).toBe('14. Okt.')
    expect(shortDate(new Date(2026, 0, 2, 23, 59).getTime(), now)).toBe('2. Jan.')
  })

  it('is the whole date for what is from another year', () => {
    expect(shortDate(new Date(2025, 11, 31, 12, 0).getTime(), now)).toBe('31.12.2025')
  })

  it('does not take yesterday for today, even a minute before midnight', () => {
    expect(shortDate(new Date(2026, 9, 19, 23, 59).getTime(), now)).toBe('19. Okt.')
  })
})
