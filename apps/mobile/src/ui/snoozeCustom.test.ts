import { describe, expect, it } from 'vitest'
import { customMoment, defaultMoment, momentOn, parseTime, snoozeDays } from './snoozeCustom'

// Friday the 23rd of October 2026, in the clock of the machine that runs the test.
const at = (hours: number, minutes = 0, day = 23) => new Date(2026, 9, day, hours, minutes)

describe('the days that can be chosen', () => {
  it('start today, call today and tomorrow by name and the others by the day, and are fourteen', () => {
    const days = snoozeDays(at(14, 30))
    expect(days).toHaveLength(14)
    expect(days[0].label).toBe('Heute')
    expect(days[1].label).toBe('Morgen')
    expect(days[2].label).toContain('25')
    expect(days[0].start.getTime()).toBe(new Date(2026, 9, 23).getTime())
    expect(days[13].start.getTime()).toBe(new Date(2026, 10, 5).getTime())
  })
})

describe('a time of day as it is typed', () => {
  it('is read in the ways it is written', () => {
    expect(parseTime('8')).toBe(8 * 60)
    expect(parseTime('8:30')).toBe(8 * 60 + 30)
    expect(parseTime('08:30')).toBe(8 * 60 + 30)
    expect(parseTime('14.15')).toBe(14 * 60 + 15)
    expect(parseTime('0830')).toBe(8 * 60 + 30)
    expect(parseTime('  23:59 ')).toBe(23 * 60 + 59)
    expect(parseTime('0:00')).toBe(0)
  })

  it('is not read when it is no time', () => {
    for (const typed of ['', 'abc', '24:00', '8:60', '8:5', '123', '8:30:00', '-1', '8 30']) expect(parseTime(typed)).toBeUndefined()
  })
})

describe('a moment on a day', () => {
  it('is the time on that day, by the clock of the day', () => {
    expect(momentOn(new Date(2026, 9, 24), 8 * 60 + 5)).toBe(new Date(2026, 9, 24, 8, 5).getTime())
  })
})

describe('the moment that was chosen', () => {
  const day = new Date(2026, 9, 23)

  it('is the moment when the day and the time are ahead of now', () => {
    expect(customMoment(day, '15:00', at(14, 30))).toEqual({ ok: true, until: at(15).getTime() })
  })

  it('is none for a time that is no time', () => {
    expect(customMoment(day, '25:00', at(14, 30))).toEqual({ ok: false, reason: 'time' })
  })

  it('is none for a moment that is past, or is now, which would bring the message back before it went', () => {
    expect(customMoment(day, '14:00', at(14, 30))).toEqual({ ok: false, reason: 'past' })
    expect(customMoment(day, '14:30', at(14, 30))).toEqual({ ok: false, reason: 'past' })
  })
})

describe('what is offered first', () => {
  it('is the next full hour of today', () => {
    expect(defaultMoment(at(14, 30))).toEqual({ dayIndex: 0, time: '15:00' })
    expect(defaultMoment(at(9, 0))).toEqual({ dayIndex: 0, time: '10:00' })
  })

  it('is the morning of tomorrow when the next full hour is not today', () => {
    expect(defaultMoment(at(23, 10))).toEqual({ dayIndex: 1, time: '08:00' })
  })
})
