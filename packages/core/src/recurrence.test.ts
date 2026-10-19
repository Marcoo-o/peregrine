import { describe, expect, it } from 'vitest'
import {
  currentDayKey,
  fromDayKey,
  nextOccurrence,
  occursOn,
  parseRecurrence,
  serializeRecurrence,
  toDayKey,
  type Recurrence
} from './recurrence'

describe('parseRecurrence', () => {
  it('reads the rules', () => {
    expect(parseRecurrence('daily')).toEqual({ kind: 'daily' })
    expect(parseRecurrence('weekdays')).toEqual({ kind: 'weekdays' })
    expect(parseRecurrence('weekly:1')).toEqual({ kind: 'weekly', weekday: 1 })
    expect(parseRecurrence('monthly:31')).toEqual({ kind: 'monthly', day: 31 })
  })

  // A task whose rule cannot be read should still appear once, not disappear.
  it('anything unreadable becomes a one-off', () => {
    expect(parseRecurrence('jeden zweiten Dienstag')).toEqual({ kind: 'once' })
    expect(parseRecurrence('weekly:9')).toEqual({ kind: 'once' })
    expect(parseRecurrence('monthly:0')).toEqual({ kind: 'once' })
    expect(parseRecurrence('monthly:32')).toEqual({ kind: 'once' })
    expect(parseRecurrence('')).toEqual({ kind: 'once' })
    expect(parseRecurrence(null)).toEqual({ kind: 'once' })
  })

  it('round-trips', () => {
    const rules: Recurrence[] = [
      { kind: 'once' },
      { kind: 'daily' },
      { kind: 'weekdays' },
      { kind: 'weekly', weekday: 0 },
      { kind: 'monthly', day: 31 }
    ]
    for (const rule of rules) {
      expect(parseRecurrence(serializeRecurrence(rule))).toEqual(rule)
    }
  })
})

describe('toDayKey / fromDayKey', () => {
  // toISOString would move the date by the UTC offset. Late evening becomes tomorrow.
  it('uses the local date, not UTC', () => {
    expect(toDayKey(new Date(2026, 7, 7, 23, 30))).toBe('2026-08-07')
    expect(toDayKey(new Date(2026, 0, 1, 0, 15))).toBe('2026-01-01')
  })

  it('rejects a date that does not exist', () => {
    expect(fromDayKey('2026-02-31')).toBeNull()
    expect(fromDayKey('2026-13-01')).toBeNull()
    expect(fromDayKey('07.08.2026')).toBeNull()
  })

  it('reads a valid key back', () => {
    expect(toDayKey(fromDayKey('2026-08-07') as Date)).toBe('2026-08-07')
  })
})

describe('currentDayKey', () => {
  it('plain calendar days when the day starts at midnight', () => {
    expect(currentDayKey(new Date(2026, 7, 7, 0, 5), 0)).toBe('2026-08-07')
    expect(currentDayKey(new Date(2026, 7, 7, 23, 55), 0)).toBe('2026-08-07')
  })

  // Someone still working at one in the morning is having yesterday.
  it('before the start hour the day before is still running', () => {
    expect(currentDayKey(new Date(2026, 7, 7, 1, 0), 4)).toBe('2026-08-06')
    expect(currentDayKey(new Date(2026, 7, 7, 3, 59), 4)).toBe('2026-08-06')
    expect(currentDayKey(new Date(2026, 7, 7, 4, 0), 4)).toBe('2026-08-07')
  })

  it('rolls over the month boundary', () => {
    expect(currentDayKey(new Date(2026, 7, 1, 2, 0), 4)).toBe('2026-07-31')
  })
})

describe('occursOn', () => {
  const start = '2026-08-07' // a Friday

  it('a one-off is due on its own day only', () => {
    expect(occursOn({ kind: 'once' }, '2026-08-07', start)).toBe(true)
    expect(occursOn({ kind: 'once' }, '2026-08-08', start)).toBe(false)
  })

  it('daily is due every day from the start', () => {
    expect(occursOn({ kind: 'daily' }, '2026-08-07', start)).toBe(true)
    expect(occursOn({ kind: 'daily' }, '2026-12-24', start)).toBe(true)
  })

  // A rule must not reach into the past, or a new weekly task arrives already overdue for
  // every week since the epoch.
  it('nothing is due before the task existed', () => {
    expect(occursOn({ kind: 'daily' }, '2026-08-06', start)).toBe(false)
    expect(occursOn({ kind: 'weekly', weekday: 5 }, '2026-07-31', start)).toBe(false)
  })

  it('weekdays skips the weekend', () => {
    expect(occursOn({ kind: 'weekdays' }, '2026-08-07', start)).toBe(true) // Friday
    expect(occursOn({ kind: 'weekdays' }, '2026-08-08', start)).toBe(false) // Saturday
    expect(occursOn({ kind: 'weekdays' }, '2026-08-09', start)).toBe(false) // Sunday
    expect(occursOn({ kind: 'weekdays' }, '2026-08-10', start)).toBe(true) // Monday
  })

  it('weekly matches its weekday', () => {
    expect(occursOn({ kind: 'weekly', weekday: 1 }, '2026-08-10', start)).toBe(true)
    expect(occursOn({ kind: 'weekly', weekday: 1 }, '2026-08-11', start)).toBe(false)
  })

  // "Every month on the 31st" in February means the last day, not "never".
  it('monthly falls back to the last day of a short month', () => {
    const rule: Recurrence = { kind: 'monthly', day: 31 }
    const from = '2026-01-01'
    expect(occursOn(rule, '2026-01-31', from)).toBe(true)
    expect(occursOn(rule, '2026-02-28', from)).toBe(true)
    expect(occursOn(rule, '2026-02-27', from)).toBe(false)
    expect(occursOn(rule, '2026-04-30', from)).toBe(true)
    expect(occursOn(rule, '2026-04-29', from)).toBe(false)
  })

  it('the 29th exists in a leap February', () => {
    const rule: Recurrence = { kind: 'monthly', day: 29 }
    expect(occursOn(rule, '2028-02-29', '2028-01-01')).toBe(true)
    // 2026 is not a leap year, so the 28th is the last day and carries it.
    expect(occursOn(rule, '2026-02-28', '2026-01-01')).toBe(true)
  })

  it('a monthly rule is due twelve times a year', () => {
    const rule: Recurrence = { kind: 'monthly', day: 31 }
    let count = 0
    for (const month of Array.from({ length: 12 }, (_, i) => i)) {
      const days = new Date(2026, month + 1, 0).getDate()
      for (let d = 1; d <= days; d++) {
        if (occursOn(rule, toDayKey(new Date(2026, month, d)), '2026-01-01')) count++
      }
    }
    expect(count).toBe(12)
  })
})

describe('nextOccurrence', () => {
  const start = '2026-08-07'

  it('finds today when today matches', () => {
    expect(nextOccurrence({ kind: 'daily' }, '2026-08-10', start)).toBe('2026-08-10')
  })

  it('skips to the next weekday', () => {
    // Saturday -> Monday
    expect(nextOccurrence({ kind: 'weekdays' }, '2026-08-08', start)).toBe('2026-08-10')
  })

  it('finds the next matching weekday', () => {
    expect(nextOccurrence({ kind: 'weekly', weekday: 3 }, '2026-08-07', start)).toBe('2026-08-12')
  })

  it('finds the next month-end', () => {
    expect(nextOccurrence({ kind: 'monthly', day: 31 }, '2026-02-01', '2026-01-01')).toBe('2026-02-28')
  })

  it('never looks before the start', () => {
    expect(nextOccurrence({ kind: 'daily' }, '2020-01-01', start)).toBe(start)
  })

  it('a one-off that has passed has no next', () => {
    expect(nextOccurrence({ kind: 'once' }, '2026-08-08', start)).toBeNull()
  })
})
