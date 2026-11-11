import { describe, expect, it } from 'vitest'
import { applyAutoBackup, DEFAULT_AUTO, loadAutoBackup, runAutoBackup, saveAutoBackup } from './autoBackup'
import { nextRun } from './backupSchedule'
import type { BackupState } from './app/screens'
import { appHarness } from './testing/appHarness'

const NOW = new Date(2026, 10, 10, 12, 0, 0)

async function withBackup(over: Partial<typeof DEFAULT_AUTO> = {}) {
  const t = await appHarness()
  await t.givenAccount('work', { INBOX: [] }, { password: 'demo-secret' })
  t.backupFolder.folder = 'Backups'
  t.backupFolder.password = 'file-password'
  await saveAutoBackup(t.db, { enabled: true, ...over })
  return t
}

const bundleOf = (content: Uint8Array) => JSON.parse(new TextDecoder().decode(content)) as { accounts: Array<{ password?: string }>; app: string }

describe('the settings of the scheduled backup', () => {
  it('are off to begin with, a week apart on a Sunday at three, keeping five files, with the keys and without the passwords', async () => {
    const t = await appHarness()
    expect(await loadAutoBackup(t.db)).toEqual({ enabled: false, intervalDays: 7, weekday: 0, hour: 3, minute: 0, keep: 5, passwords: false, privateKeys: true, lastRun: 0, status: '' })
  })

  it('are kept, and what is not reasonable takes its default', async () => {
    const t = await appHarness()
    await saveAutoBackup(t.db, { enabled: true, intervalDays: 14, hour: 22 })
    expect(await loadAutoBackup(t.db)).toMatchObject({ enabled: true, intervalDays: 14, hour: 22 })
    await t.db.run("UPDATE settings SET value = ? WHERE name = 'autoBackup'", JSON.stringify({ enabled: true, intervalDays: 5, weekday: 9, hour: 40, keep: 7, minute: -1 }))
    expect(await loadAutoBackup(t.db)).toMatchObject({ enabled: true, intervalDays: 7, weekday: 0, hour: 3, minute: 0, keep: 5 })
  })
})

describe('putting the schedule in force', () => {
  it('cancels the run while it is off, and while there is no folder or no password', async () => {
    const t = await appHarness()
    expect(await applyAutoBackup(t.db, t.backupFolder, NOW.getTime())).toBe('off')
    await saveAutoBackup(t.db, { enabled: true })
    expect(await applyAutoBackup(t.db, t.backupFolder, NOW.getTime())).toBe('incomplete')
    t.backupFolder.folder = 'Backups'
    expect(await applyAutoBackup(t.db, t.backupFolder, NOW.getTime())).toBe('incomplete')
    expect(t.backupFolder.armed).toEqual([null, null, null])
  })

  it('arms the next run at the moment the schedule gives, counted from the last', async () => {
    const t = await withBackup({ lastRun: new Date(2026, 10, 8, 3).getTime() })
    expect(await applyAutoBackup(t.db, t.backupFolder, NOW.getTime())).toBe('armed')
    expect(t.backupFolder.armed).toEqual([nextRun(await loadAutoBackup(t.db), new Date(2026, 10, 8, 3).getTime(), NOW.getTime())])
  })
})

describe('a scheduled run', () => {
  it('writes the bundle with the name of the day and the number to keep, says what it did, and arms the next run', async () => {
    const t = await withBackup({ keep: 10 })
    const run = await runAutoBackup(t.db, t.backupFolder, NOW)
    expect(run.ok).toBe(true)
    expect(t.backupFolder.written).toHaveLength(1)
    expect(t.backupFolder.written[0]).toMatchObject({ name: 'peregrine-backup-auto-2026-11-10_120000.pgbk', keep: 10 })
    expect(bundleOf(t.backupFolder.written[0].content)).toMatchObject({ app: 'peregrine', accounts: [{}] })
    expect(run.status).toBe('2026-11-10 12:00: gesichert. Darin: 1 Konto, 1 Absender, 1 Einstellung.')
    const saved = await loadAutoBackup(t.db)
    expect(saved).toMatchObject({ lastRun: NOW.getTime(), status: run.status })
    expect(t.backupFolder.armed.at(-1)).toBe(nextRun(saved, NOW.getTime(), NOW.getTime()))
    expect(t.backupFolder.armed.at(-1)).toBeGreaterThan(NOW.getTime())
  })

  it('has the passwords of the accounts in the file only when it was set to', async () => {
    const off = await withBackup()
    await runAutoBackup(off.db, off.backupFolder, NOW)
    expect(JSON.stringify(bundleOf(off.backupFolder.written[0].content))).not.toContain('demo-secret')
    const on = await withBackup({ passwords: true })
    await runAutoBackup(on.db, on.backupFolder, NOW)
    expect(JSON.stringify(bundleOf(on.backupFolder.written[0].content))).toContain('demo-secret')
  })

  it('does nothing while it is off, and cancels what was armed', async () => {
    const t = await appHarness()
    const run = await runAutoBackup(t.db, t.backupFolder, NOW)
    expect(run).toMatchObject({ skipped: 'off', ok: false })
    expect(t.backupFolder.written).toEqual([])
    expect(t.backupFolder.armed).toEqual([null])
  })

  it('says what is missing, tries again after one interval, and does not throw, when there is no folder or no password', async () => {
    const t = await withBackup()
    t.backupFolder.folder = null
    const run = await runAutoBackup(t.db, t.backupFolder, NOW)
    expect(run.ok).toBe(false)
    expect(run.status).toContain('kein Ordner')
    t.backupFolder.folder = 'Backups'
    t.backupFolder.password = null
    expect((await runAutoBackup(t.db, t.backupFolder, NOW)).status).toContain('kein Passwort')
    expect((await loadAutoBackup(t.db)).lastRun).toBe(NOW.getTime())
    expect(t.backupFolder.armed.at(-1)).toBeGreaterThan(NOW.getTime())
  })

  it('says why when the file could not be written, and still arms the next run', async () => {
    const t = await withBackup()
    t.backupFolder.failWith = new Error('no space')
    const run = await runAutoBackup(t.db, t.backupFolder, NOW)
    expect(run).toMatchObject({ ok: false, status: '2026-11-10 12:00: fehlgeschlagen: no space' })
    expect(t.backupFolder.armed).toHaveLength(1)
  })
})

describe('the screen for the scheduled backup', () => {
  const shown = (t: Awaited<ReturnType<typeof appHarness>>) => t.store.screen as BackupState

  it('shows what is chosen and kept, and cannot be switched on before a folder and a password are there', async () => {
    const t = await appHarness()
    await t.app.backup.show()
    expect(shown(t).auto).toMatchObject({ folder: null, hasPassword: false, settings: { enabled: false } })
    await t.app.backup.setAuto({ enabled: true })
    expect(shown(t).error).toContain('zuerst einen Ordner')
    expect(shown(t).auto.settings.enabled).toBe(false)
  })

  it('takes the folder and the password, then switches on and arms the next run, and keeps a change of the schedule', async () => {
    const t = await appHarness()
    await t.app.backup.chooseFolder()
    expect(shown(t)).toMatchObject({ notice: expect.stringContaining('Backups'), auto: { folder: 'Backups' } })
    await t.app.backup.rememberPassword('short')
    expect(shown(t).error).toContain('mindestens 8')
    expect(t.backupFolder.password).toBeNull()
    await t.app.backup.rememberPassword('long enough')
    expect(t.backupFolder.password).toBe('long enough')
    expect(shown(t).auto.hasPassword).toBe(true)
    await t.app.backup.setAuto({ enabled: true })
    expect(shown(t).auto.settings.enabled).toBe(true)
    expect(t.backupFolder.armed.at(-1)).toBeGreaterThan(Date.now())
    await t.app.backup.setAuto({ intervalDays: 14, weekday: 3, hour: 22 })
    expect(shown(t).auto.settings).toMatchObject({ intervalDays: 14, weekday: 3, hour: 22 })
    expect(new Date(t.backupFolder.armed.at(-1) as number).getDay()).toBe(3)
  })

  it('says nothing when no folder was chosen, and says why when choosing failed', async () => {
    const t = await appHarness()
    t.backupFolder.chooseAnswer = null
    await t.app.backup.chooseFolder()
    expect(shown(t)).toMatchObject({ notice: undefined, error: undefined })
    t.backupFolder.chooseFolder = async () => {
      throw new Error('no screen')
    }
    await t.app.backup.chooseFolder()
    expect(shown(t).error).toContain('no screen')
  })

  it('forgets the password and with it switches the schedule off and cancels the run', async () => {
    const t = await withBackup()
    await t.app.backup.forgetPassword()
    expect(t.backupFolder.password).toBeNull()
    expect((await loadAutoBackup(t.db)).enabled).toBe(false)
    expect(t.backupFolder.armed.at(-1)).toBeNull()
  })

  it('asks the scheduler for a run now, and shows what it came to when the run has recorded itself', async () => {
    const t = await withBackup()
    t.app.backup.delay = async () => undefined
    t.backupFolder.onRun = async () => {
      await saveAutoBackup(t.db, { lastRun: 123, status: 'done' })
    }
    await t.app.backup.runAutoNow()
    expect(t.backupFolder.runs).toBe(1)
    expect(shown(t).busy).toBeUndefined()
    expect(shown(t).auto.settings).toMatchObject({ lastRun: 123, status: 'done' })
  })

  it('says that the result is still to come when the run does not record itself in time, and stops looking when the screen is left', async () => {
    const t = await withBackup()
    t.app.backup.delay = async () => undefined
    await t.app.backup.runAutoNow()
    expect(shown(t).notice).toContain('noch aus')
    let looks = 0
    t.app.backup.delay = async () => {
      looks += 1
      t.store.showScreen({ name: 'login' })
    }
    await t.app.backup.runAutoNow()
    expect(looks).toBe(1)
    expect(t.store.screen.name).toBe('login')
  })

  it('has the schedule armed again when the application starts', async () => {
    const t = await withBackup()
    t.backupFolder.armed.length = 0
    await t.app.start()
    expect(t.backupFolder.armed.at(-1)).toBeGreaterThan(Date.now())
  })
})
