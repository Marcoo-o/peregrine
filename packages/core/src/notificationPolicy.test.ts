import { describe, expect, it } from 'vitest'
import {
  isQuietTime,
  parseMutedAccounts,
  parseTimeOfDay,
  shouldNotify,
  type NotificationPolicy
} from './notificationPolicy'

function at(hour: number, minute = 0): Date {
  return new Date(2026, 7, 7, hour, minute)
}

function policy(patch: Partial<NotificationPolicy> = {}): NotificationPolicy {
  return { enabled: true, mutedAccountIds: [], quietFrom: '', quietTo: '', ...patch }
}

describe('parseTimeOfDay', () => {
  it('reads a time as minutes since midnight', () => {
    expect(parseTimeOfDay('07:30')).toBe(450)
    expect(parseTimeOfDay('00:00')).toBe(0)
    expect(parseTimeOfDay('23:59')).toBe(1439)
  })

  it('rejects what is not a time', () => {
    expect(parseTimeOfDay('')).toBeNull()
    expect(parseTimeOfDay('24:00')).toBeNull()
    expect(parseTimeOfDay('7:30')).toBeNull()
    expect(parseTimeOfDay('19:60')).toBeNull()
    expect(parseTimeOfDay(undefined)).toBeNull()
  })
})

describe('isQuietTime', () => {
  it('an ordinary window covers the hours between its bounds', () => {
    expect(isQuietTime(at(13), '12:00', '14:00')).toBe(true)
    expect(isQuietTime(at(11, 59), '12:00', '14:00')).toBe(false)
    expect(isQuietTime(at(14), '12:00', '14:00')).toBe(false)
  })

  // The case people actually configure, and the one a between-check gets backwards.
  it('a window across midnight covers both sides of it', () => {
    expect(isQuietTime(at(23), '22:00', '07:00')).toBe(true)
    expect(isQuietTime(at(3), '22:00', '07:00')).toBe(true)
    expect(isQuietTime(at(22), '22:00', '07:00')).toBe(true)
    expect(isQuietTime(at(7), '22:00', '07:00')).toBe(false)
    expect(isQuietTime(at(12), '22:00', '07:00')).toBe(false)
  })

  // Inclusive start, exclusive end: together the two halves cover the day exactly once.
  it('no minute belongs to both halves of the day', () => {
    for (let hour = 0; hour < 24; hour++) {
      const night = isQuietTime(at(hour), '22:00', '07:00')
      const day = isQuietTime(at(hour), '07:00', '22:00')
      expect(night).not.toBe(day)
    }
  })

  it('is off without a valid pair of times', () => {
    expect(isQuietTime(at(3), '', '')).toBe(false)
    expect(isQuietTime(at(3), '22:00', '')).toBe(false)
    expect(isQuietTime(at(3), 'abends', '07:00')).toBe(false)
  })

  // Equal bounds are an empty window, not a permanently silent app.
  it('equal bounds silence nothing', () => {
    expect(isQuietTime(at(3), '08:00', '08:00')).toBe(false)
    expect(isQuietTime(at(8), '08:00', '08:00')).toBe(false)
  })
})

describe('parseMutedAccounts', () => {
  it('reads a stored list', () => {
    expect(parseMutedAccounts('["a","b"]')).toEqual(['a', 'b'])
  })

  it('a damaged value silences nothing', () => {
    expect(parseMutedAccounts('kaputt')).toEqual([])
    expect(parseMutedAccounts('{"a":1}')).toEqual([])
    expect(parseMutedAccounts(undefined)).toEqual([])
  })

  it('drops entries that are not ids', () => {
    expect(parseMutedAccounts('["a",7,null,"b"]')).toEqual(['a', 'b'])
  })
})

describe('shouldNotify', () => {
  it('notifies by default', () => {
    expect(shouldNotify(policy(), 'a', at(12))).toBe(true)
  })

  it('stays silent when switched off', () => {
    expect(shouldNotify(policy({ enabled: false }), 'a', at(12))).toBe(false)
  })

  it('stays silent for a muted account', () => {
    expect(shouldNotify(policy({ mutedAccountIds: ['a'] }), 'a', at(12))).toBe(false)
    expect(shouldNotify(policy({ mutedAccountIds: ['a'] }), 'b', at(12))).toBe(true)
  })

  it('stays silent during quiet hours', () => {
    const p = policy({ quietFrom: '22:00', quietTo: '07:00' })
    expect(shouldNotify(p, 'a', at(2))).toBe(false)
    expect(shouldNotify(p, 'a', at(9))).toBe(true)
  })
})
