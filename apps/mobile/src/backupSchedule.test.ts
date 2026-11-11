import { describe, expect, it } from 'vitest'
import { autoBackupName, nextRun, type BackupSchedule } from './backupSchedule'

// Local times throughout, as the schedule is the phone's.
const at = (y: number, m: number, d: number, h = 0, min = 0): number => new Date(y, m - 1, d, h, min).getTime()
const day = (ms: number): number => new Date(ms).getDay()

const SUNDAY_3: BackupSchedule = { intervalDays: 7, weekday: 0, hour: 3, minute: 0 }
const DAILY_3: BackupSchedule = { intervalDays: 1, weekday: 0, hour: 3, minute: 0 }

describe('when the next backup runs', () => {
  it('is the next slot after now when there never was one', () => {
    // 2026-11-10 is a Tuesday: the next Sunday is the 15th.
    expect(nextRun(SUNDAY_3, 0, at(2026, 11, 10, 12))).toBe(at(2026, 11, 15, 3))
    expect(nextRun(DAILY_3, 0, at(2026, 11, 10, 12))).toBe(at(2026, 11, 11, 3))
    expect(nextRun(DAILY_3, 0, at(2026, 11, 10, 1))).toBe(at(2026, 11, 10, 3))
  })

  it('is always after now, and on the chosen weekday and time', () => {
    for (const interval of [7, 14, 28]) {
      const schedule = { intervalDays: interval, weekday: 3, hour: 22, minute: 30 }
      for (let d = 1; d <= 60; d += 7) {
        const now = at(2026, 11, d % 28 || 1, 9)
        const next = nextRun(schedule, now - 86_400_000, now)
        expect(next).toBeGreaterThan(now)
        expect(day(next)).toBe(3)
        expect(new Date(next).getHours()).toBe(22)
        expect(new Date(next).getMinutes()).toBe(30)
      }
    }
  })

  it('lands on the same weekday again one interval after a regular run', () => {
    const last = at(2026, 11, 8, 3)
    expect(nextRun(SUNDAY_3, last, last + 60_000)).toBe(at(2026, 11, 15, 3))
    expect(nextRun({ ...SUNDAY_3, intervalDays: 14 }, last, last + 60_000)).toBe(at(2026, 11, 22, 3))
  })

  it('is not moved to another weekday by a backup made by hand in between', () => {
    // Made by hand on a Wednesday: the next is still a Sunday, the first one at least four days after.
    const byHand = at(2026, 11, 11, 15)
    const next = nextRun(SUNDAY_3, byHand, byHand + 1000)
    expect(day(next)).toBe(0)
    expect(next).toBe(at(2026, 11, 22, 3))
  })

  it('runs a daily one a day later at the time, and the same day when the time has not come', () => {
    expect(nextRun(DAILY_3, at(2026, 11, 10, 3), at(2026, 11, 10, 3, 5))).toBe(at(2026, 11, 11, 3))
    expect(nextRun(DAILY_3, at(2026, 11, 10, 3), at(2026, 11, 10, 3, 5))).toBeGreaterThan(at(2026, 11, 10, 3, 5))
  })

  it('catches up with one run, and not with all that were missed, when the phone was off for weeks', () => {
    const next = nextRun(SUNDAY_3, at(2026, 9, 6, 3), at(2026, 11, 10, 12))
    expect(next).toBe(at(2026, 11, 15, 3))
  })
})

describe('the name of an automatic backup', () => {
  it('begins with what pruning looks for and sorts by time', () => {
    const a = autoBackupName(new Date(2026, 10, 8, 3, 0, 0))
    const b = autoBackupName(new Date(2026, 10, 15, 3, 0, 5))
    expect(a).toBe('peregrine-backup-auto-2026-11-08_030000.pgbk')
    expect([b, a].sort()).toEqual([a, b])
  })
})
