/**
 * When a scheduled backup runs: every `intervalDays` days (1, 7, 14 or 28), on `weekday` (not for a daily one) at `hour`:`minute`, in the time of the phone.
 * It is the suite's rule: the next run counts from the last, but the weekday and the time are fixed, so a backup made by hand on a Monday does not push a "Sunday at
 * 3" schedule to another day.
 */
export interface BackupSchedule {
  intervalDays: number
  /** 0 is Sunday, as `Date#getDay` has it. */
  weekday: number
  hour: number
  minute: number
}

export const INTERVALS: readonly number[] = [1, 7, 14, 28]

export const DEFAULT_SCHEDULE: BackupSchedule = { intervalDays: 7, weekday: 0, hour: 3, minute: 0 }

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The next run, always after `nowMs`. `lastRunMs` is the time of the last run, 0 when there never was one (the next slot after now then). The slack makes the next slot
 * the one closest to "one interval after the last run", so a regular run lands on the same weekday again: half a day for a daily one, three days for the others.
 */
export function nextRun(schedule: BackupSchedule, lastRunMs: number, nowMs: number): number {
  const slack = schedule.intervalDays === 1 ? DAY_MS / 2 : 3 * DAY_MS
  const earliest = Math.max(lastRunMs + schedule.intervalDays * DAY_MS - slack, nowMs + 1)
  const slot = new Date(earliest)
  slot.setHours(schedule.hour, schedule.minute, 0, 0)
  if (slot.getTime() < earliest) slot.setDate(slot.getDate() + 1)
  if (schedule.intervalDays > 1) {
    while (slot.getDay() !== schedule.weekday) slot.setDate(slot.getDate() + 1)
  }
  return slot.getTime()
}

/** What the names of the automatic backups begin with, so that nothing else in the folder is touched. */
export const AUTO_PREFIX = 'peregrine-backup-auto-'

const pad = (n: number): string => String(n).padStart(2, '0')

/** The name of an automatic backup made at a moment, which sorts by time. */
export function autoBackupName(at: Date): string {
  return `${AUTO_PREFIX}${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}_${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}.pgbk`
}
