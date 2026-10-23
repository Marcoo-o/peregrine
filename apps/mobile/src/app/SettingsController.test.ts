import { describe, expect, it } from 'vitest'
import { loadNotificationSettings } from '../settings'
import { appHarness } from '../testing/appHarness'
import type { SettingsState } from './screens'

async function onSettings() {
  const t = await appHarness()
  const work = await t.givenAccount('work', {})
  const home = await t.givenAccount('home', {})
  await t.app.settings.show()
  const screen = () => t.store.screen as SettingsState
  return { ...t, work, home, screen }
}

describe('the settings screen', () => {
  it('shows what is stored, the accounts, and whether the system allows notifications', async () => {
    const t = await onSettings()
    t.notifications.allowed = true
    await t.app.settings.show()
    expect(t.screen()).toMatchObject({
      name: 'settings',
      settings: { enabled: false, preview: true },
      permitted: true
    })
    expect(t.screen().accounts.map((a) => a.displayName)).toEqual(['work', 'home'])
  })

  it('goes back to the accounts', async () => {
    const t = await onSettings()
    await t.app.settings.back()
    expect(t.store.screen.name).toBe('accounts')
  })

  describe('switching notifications on', () => {
    it('asks for the permission, keeps the switch on, and has the platform look every so often', async () => {
      const t = await onSettings()
      await t.app.settings.setEnabled(true)
      expect(t.screen().settings.enabled).toBe(true)
      expect(t.screen().permitted).toBe(true)
      expect(t.syncSchedule.calls).toEqual(['schedule 30'])
    })

    it('stays off, and says why, when the user does not give the permission', async () => {
      const t = await onSettings()
      t.notifications.willAllow = false
      await t.app.settings.setEnabled(true)
      expect(t.screen().settings.enabled).toBe(false)
      expect(t.screen().notice).toContain('Systemeinstellungen')
      expect(t.syncSchedule.calls).toEqual(['cancel'])
    })

    it('is not asked again for a permission that is given', async () => {
      const t = await onSettings()
      await t.app.settings.setEnabled(true)
      await t.app.settings.setEnabled(false)
      await t.app.settings.setEnabled(true)
      expect(t.screen().settings.enabled).toBe(true)
    })
  })

  it('switching them off stops the look and takes down what is shown', async () => {
    const t = await onSettings()
    await t.app.settings.setEnabled(true)
    await t.app.settings.setEnabled(false)
    expect(t.screen().settings.enabled).toBe(false)
    expect(t.syncSchedule.calls).toEqual(['schedule 30', 'cancel'])
    expect(t.notifications.cleared).toBe(1)
  })

  it('has the preview switched off and on', async () => {
    const t = await onSettings()
    await t.app.settings.setPreview(false)
    expect(t.screen().settings.preview).toBe(false)
    await t.app.settings.setPreview(true)
    expect(t.screen().settings.preview).toBe(true)
  })

  it('has the text under the subjects of the lists switched off and on, and the lists carry it', async () => {
    const t = await onSettings()
    expect(t.screen().list).toEqual({ showPreview: true })
    await t.app.settings.setShowPreview(false)
    expect(t.screen().list).toEqual({ showPreview: false })

    await t.app.navigator.showUnified({ refresh: false })
    expect(t.store.screen).toMatchObject({ name: 'unified', showPreview: false })
    await t.app.navigator.showSearch('x')
    expect(t.store.screen).toMatchObject({ name: 'search', showPreview: false })
  })

  describe('the quiet hours', () => {
    it('are switched on with the usual night and off with none', async () => {
      const t = await onSettings()
      await t.app.settings.setQuietHours(true)
      expect(t.screen().settings).toMatchObject({ quietFrom: '22:00', quietTo: '07:00' })
      await t.app.settings.setQuietHours(false)
      expect(t.screen().settings).toMatchObject({ quietFrom: '', quietTo: '' })
    })

    it('take a time of day for either end', async () => {
      const t = await onSettings()
      await t.app.settings.setQuietHours(true)
      await t.app.settings.setQuietTime('quietFrom', '23:15')
      await t.app.settings.setQuietTime('quietTo', '06:30')
      expect(t.screen().settings).toMatchObject({ quietFrom: '23:15', quietTo: '06:30' })
    })

    it('do not take what is not a time of day, and say what is wanted', async () => {
      const t = await onSettings()
      await t.app.settings.setQuietHours(true)
      await t.app.settings.setQuietTime('quietFrom', '25:00')
      await t.app.settings.setQuietTime('quietTo', 'night')
      expect(t.screen().settings).toMatchObject({ quietFrom: '22:00', quietTo: '07:00' })
      expect(t.screen().notice).toContain('Uhrzeit')
    })
  })

  it('has an account muted and heard again', async () => {
    const t = await onSettings()
    await t.app.settings.toggleMuted(t.work.id)
    expect(t.screen().settings.mutedAccountIds).toEqual([t.work.id])
    await t.app.settings.toggleMuted(t.home.id)
    expect(t.screen().settings.mutedAccountIds).toEqual([t.work.id, t.home.id])
    await t.app.settings.toggleMuted(t.work.id)
    expect(t.screen().settings.mutedAccountIds).toEqual([t.home.id])
  })

  describe('the interval', () => {
    it('is given to the platform when notifications are on', async () => {
      const t = await onSettings()
      await t.app.settings.setEnabled(true)
      await t.app.settings.setInterval(60)
      expect(t.screen().settings.intervalMinutes).toBe(60)
      expect(t.syncSchedule.calls).toEqual(['schedule 30', 'schedule 60'])
    })

    it('is kept and nothing is scheduled when notifications are off', async () => {
      const t = await onSettings()
      await t.app.settings.setInterval(120)
      expect(t.screen().settings.intervalMinutes).toBe(120)
      expect(t.syncSchedule.calls).toEqual(['cancel'])
    })
  })

  describe('looking now', () => {
    it('asks the platform to, and says that it is under way', async () => {
      const t = await onSettings()
      await t.app.settings.setEnabled(true)
      await t.app.settings.runNow()
      expect(t.syncSchedule.calls).toContain('runNow')
      expect(t.screen().notice).toContain('Abruf läuft')
    })

    it('does nothing while notifications are off, and says so', async () => {
      const t = await onSettings()
      await t.app.settings.runNow()
      expect(t.syncSchedule.calls).not.toContain('runNow')
      expect(t.screen().notice).toContain('ausgeschaltet')
    })

    it('says why when the platform could not', async () => {
      const t = await onSettings()
      await t.app.settings.setEnabled(true)
      t.syncSchedule.failWith = new Error('no scheduler')
      await t.app.settings.runNow()
      expect(t.screen().notice).toBe('Der Abruf ging nicht: no scheduler')
    })
  })

  describe('the schedule of the platform', () => {
    it('is what the settings say, at every start', async () => {
      const t = await onSettings()
      await t.app.settings.applySchedule()
      expect(t.syncSchedule.calls).toEqual(['cancel'])

      await loadNotificationSettings(t.db)
      await t.app.settings.setEnabled(true)
      t.syncSchedule.calls.length = 0
      await t.app.settings.applySchedule()
      expect(t.syncSchedule.calls).toEqual(['schedule 30'])
    })

    it('that cannot be given to the platform is logged and stops nothing', async () => {
      const t = await onSettings()
      t.syncSchedule.failWith = new Error('no scheduler')
      await expect(t.app.settings.applySchedule()).resolves.toBeUndefined()
      expect(t.logs.some((line) => line.includes('no scheduler'))).toBe(true)
    })
  })
})

describe('telling the push service what to watch', () => {
  it('registers the accounts when notifications are switched on, and takes them out when they are switched off', async () => {
    const t = await onSettings()
    t.notifications.allowed = true
    await t.app.settings.setEnabled(true)
    expect([...t.push.sources.keys()].sort()).toEqual([t.work.id, t.home.id].sort())

    await t.app.settings.setEnabled(false)
    expect(t.push.sources.size).toBe(0)
    expect(t.push.calls).toContain('unregisterAll')
  })

  it('does not register what is not allowed to be shown: notifications that the system refuses stay off, and nothing is watched', async () => {
    const t = await onSettings()
    t.notifications.allowed = false
    t.notifications.willAllow = false
    await t.app.settings.setEnabled(true)
    expect(t.push.sources.size).toBe(0)
  })

  it('takes a muted account out and puts it back when it is not muted any more', async () => {
    const t = await onSettings()
    t.notifications.allowed = true
    await t.app.settings.setEnabled(true)

    await t.app.settings.toggleMuted(t.home.id)
    expect([...t.push.sources.keys()]).toEqual([t.work.id])

    await t.app.settings.toggleMuted(t.home.id)
    expect(t.push.sources.size).toBe(2)
  })

  it('is told again at every start, which is how it is right after a reinstall or an update of the system', async () => {
    const t = await onSettings()
    t.notifications.allowed = true
    await t.app.settings.setEnabled(true)
    t.push.sources.clear()
    await t.app.start()
    expect(t.push.sources.size).toBe(2)
  })

  it('goes on without the service when the device has none', async () => {
    const t = await onSettings()
    t.notifications.allowed = true
    t.push.present = false
    await t.app.settings.setEnabled(true)
    expect(t.push.calls).toEqual([])
    expect((await loadNotificationSettings(t.db)).enabled).toBe(true)
  })
})
