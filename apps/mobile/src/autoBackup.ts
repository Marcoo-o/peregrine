import type { SqlDb } from '@peregrine/core/sqlDb'
import { bundleBytes, collectBackup, countsOf, countsText } from './backup'
import { autoBackupName, DEFAULT_SCHEDULE, nextRun, type BackupSchedule } from './backupSchedule'
import { t } from './i18n'

/**
 * The scheduled backup: a folder the user chose once, a password that is entered once and kept by the Keystore, and when. The device side (the folder, the password,
 * the writing, the platform's scheduler) is `BackupFolder`; what is here is what it is told and what is made.
 *
 * The password never comes back to JavaScript after it was given: the file is sealed natively with the one that is kept, so a run that nobody sees needs nothing from
 * the user and leaves the password nowhere a script can read it.
 */
export interface BackupFolder {
  /** The name of the folder that is chosen, or null, and whether a password is kept. */
  state(): Promise<{ folder: string | null; hasPassword: boolean }>
  /** Lets the user choose the folder. Its name, or null when none was chosen. */
  chooseFolder(): Promise<string | null>
  rememberPassword(password: string): Promise<void>
  forgetPassword(): Promise<void>
  /** Seals the content with the kept password and writes it into the folder, keeping the newest `keep` automatic backups. */
  sealToFolder(name: string, content: Uint8Array, keep: number): Promise<void>
  /** Arms the next run at a moment, in milliseconds since the epoch. */
  arm(atMillis: number): Promise<void>
  disarm(): Promise<void>
  /** A run now, which is a scheduled one: it is made by the platform's scheduler, in the background. */
  runNow(): Promise<void>
}

export interface AutoBackupSettings extends BackupSchedule {
  enabled: boolean
  /** How many of the automatic files stay in the folder. */
  keep: number
  /** What goes into the file beyond what is always in it. */
  passwords: boolean
  privateKeys: boolean
  /** When the last run was, successful or not: a run that failed is tried again after one interval, so that a setup that is broken cannot loop. */
  lastRun: number
  /** What the last run came to, in a line. */
  status: string
}

export const KEEP_CHOICES: readonly number[] = [3, 5, 10, 20]

export const DEFAULT_AUTO: AutoBackupSettings = { ...DEFAULT_SCHEDULE, enabled: false, keep: 5, passwords: false, privateKeys: true, lastRun: 0, status: '' }

const NAME = 'autoBackup'

const whole = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fallback

/** The settings as stored, each part that is missing or is not reasonable taking its default. */
export async function loadAutoBackup(db: SqlDb): Promise<AutoBackupSettings> {
  const row = await db.get<{ value: string }>('SELECT value FROM settings WHERE name = ?', NAME)
  if (!row) return DEFAULT_AUTO
  try {
    const given = (JSON.parse(row.value) as Record<string, unknown> | null) ?? {}
    return {
      enabled: given.enabled === true,
      intervalDays: [1, 7, 14, 28].includes(given.intervalDays as number) ? (given.intervalDays as number) : DEFAULT_AUTO.intervalDays,
      weekday: whole(given.weekday, 0, 6, DEFAULT_AUTO.weekday),
      hour: whole(given.hour, 0, 23, DEFAULT_AUTO.hour),
      minute: whole(given.minute, 0, 59, DEFAULT_AUTO.minute),
      keep: KEEP_CHOICES.includes(given.keep as number) ? (given.keep as number) : DEFAULT_AUTO.keep,
      passwords: given.passwords === true,
      privateKeys: given.privateKeys !== false,
      lastRun: whole(given.lastRun, 0, Number.MAX_SAFE_INTEGER, 0),
      status: typeof given.status === 'string' ? given.status : ''
    }
  } catch {
    return DEFAULT_AUTO
  }
}

export async function saveAutoBackup(db: SqlDb, change: Partial<AutoBackupSettings>): Promise<AutoBackupSettings> {
  const next = { ...(await loadAutoBackup(db)), ...change }
  await db.run(
    `INSERT INTO settings (name, value) VALUES (?, ?)
     ON CONFLICT (name) DO UPDATE SET value = excluded.value`,
    NAME,
    JSON.stringify(next)
  )
  return next
}

const stamp = (at: Date): string => `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`

/**
 * Puts the schedule in force: the next run armed on the platform's scheduler when the backup is on and has what it needs (a folder and a password), and nothing armed
 * when it is not. Called when the settings change and when the application starts, so that what the phone forgot of the scheduler (it keeps it across a restart, but not
 * across a reinstall) is armed again.
 */
export async function applyAutoBackup(db: SqlDb, folder: BackupFolder, now: number = Date.now()): Promise<'armed' | 'off' | 'incomplete'> {
  const settings = await loadAutoBackup(db)
  if (!settings.enabled) {
    await folder.disarm()
    return 'off'
  }
  const state = await folder.state()
  if (!state.folder || !state.hasPassword) {
    await folder.disarm()
    return 'incomplete'
  }
  await folder.arm(nextRun(settings, settings.lastRun, now))
  return 'armed'
}

export interface AutoBackupRun {
  /** Why nothing was done, or undefined when a backup was written. */
  skipped?: 'off' | 'incomplete'
  /** The line that says what the run came to. */
  status: string
  ok: boolean
}

/**
 * One scheduled run: what the phone has into a bundle, sealed with the kept password and written into the folder. It says what it came to, for the screen, and arms the
 * next run whatever it came to. Nothing in it throws: a run that fails only says so, and is tried again after one interval.
 */
export async function runAutoBackup(db: SqlDb, folder: BackupFolder, now: Date = new Date()): Promise<AutoBackupRun> {
  const settings = await loadAutoBackup(db)
  if (!settings.enabled) {
    await folder.disarm()
    return { skipped: 'off', status: settings.status, ok: false }
  }
  let status: string
  let ok = false
  try {
    const state = await folder.state()
    if (!state.folder) throw new Error(t('Es ist kein Ordner gewählt.'))
    if (!state.hasPassword) throw new Error(t('Es ist kein Passwort gemerkt.'))
    const bundle = await collectBackup(db, { passwords: settings.passwords, privateKeys: settings.privateKeys }, now.getTime())
    await folder.sealToFolder(autoBackupName(now), bundleBytes(bundle), settings.keep)
    status = t('{when}: gesichert. Darin: {counts}.', { when: stamp(now), counts: countsText(countsOf(bundle)) })
    ok = true
  } catch (error) {
    status = t('{when}: fehlgeschlagen: {n}', { when: stamp(now), n: error instanceof Error ? error.message : String(error) })
  }
  const saved = await saveAutoBackup(db, { lastRun: now.getTime(), status })
  try {
    await folder.arm(nextRun(saved, now.getTime(), now.getTime()))
  } catch {
    // The next run could not be armed; it is armed again when the application is opened.
  }
  return { status, ok }
}
