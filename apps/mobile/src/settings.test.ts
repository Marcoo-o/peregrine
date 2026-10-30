import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LIST_SETTINGS,
  DEFAULT_NOTIFICATION_SETTINGS,
  DEFAULT_QUIET_HOURS,
  hasQuietHours,
  INTERVAL_CHOICES,
  loadListSettings,
  loadNotificationSettings,
  policyOf,
  saveListSettings,
  saveNotificationSettings
} from './settings'
import { migratedDatabase } from './testing/testDb'

describe('the notification settings', () => {
  it('are off, with the preview on, no quiet hours and every account heard, when nothing was set', async () => {
    const { db } = await migratedDatabase()
    expect(await loadNotificationSettings(db)).toEqual({
      enabled: false,
      preview: true,
      quietFrom: '',
      quietTo: '',
      mutedAccountIds: [],
      intervalMinutes: 30
    })
  })

  it('keep what was changed and the rest as it was, and come back as they were stored', async () => {
    const { db } = await migratedDatabase()
    await saveNotificationSettings(db, { enabled: true, intervalMinutes: 60 })
    const saved = await saveNotificationSettings(db, { preview: false, mutedAccountIds: ['a'] })
    expect(saved).toEqual({ ...DEFAULT_NOTIFICATION_SETTINGS, enabled: true, preview: false, mutedAccountIds: ['a'], intervalMinutes: 60 })
    expect(await loadNotificationSettings(db)).toEqual(saved)
  })

  it('are one row however often they are saved', async () => {
    const { db, raw } = await migratedDatabase()
    await saveNotificationSettings(db, { enabled: true })
    await saveNotificationSettings(db, { enabled: false })
    expect((raw.prepare('SELECT COUNT(*) AS n FROM settings').get() as { n: number }).n).toBe(1)
  })

  describe('with an interval', () => {
    it('that is one of the choices, keep it', async () => {
      const { db } = await migratedDatabase()
      for (const minutes of INTERVAL_CHOICES) {
        expect((await saveNotificationSettings(db, { intervalMinutes: minutes })).intervalMinutes).toBe(minutes)
      }
    })

    // Looking more often than was asked costs battery, looking less often only costs a delay.
    it('that is not, take the next choice up and never a shorter one', async () => {
      const { db } = await migratedDatabase()
      expect((await saveNotificationSettings(db, { intervalMinutes: 5 })).intervalMinutes).toBe(15)
      expect((await saveNotificationSettings(db, { intervalMinutes: 31 })).intervalMinutes).toBe(60)
      expect((await saveNotificationSettings(db, { intervalMinutes: 100000 })).intervalMinutes).toBe(240)
    })
  })

  describe('with quiet hours', () => {
    it('that have both ends, keep them', async () => {
      const { db } = await migratedDatabase()
      const saved = await saveNotificationSettings(db, DEFAULT_QUIET_HOURS)
      expect(saved).toMatchObject({ quietFrom: '22:00', quietTo: '07:00' })
      expect(hasQuietHours(saved)).toBe(true)
    })

    it('that have one end, or are not times, are off, because half a window is no window', async () => {
      const { db } = await migratedDatabase()
      expect(await saveNotificationSettings(db, { quietFrom: '22:00', quietTo: '' })).toMatchObject({ quietFrom: '', quietTo: '' })
      expect(await saveNotificationSettings(db, { quietFrom: '25:99', quietTo: '07:00' })).toMatchObject({ quietFrom: '', quietTo: '' })
      expect(hasQuietHours(await loadNotificationSettings(db))).toBe(false)
    })
  })

  describe('read back from what is in storage', () => {
    async function withStored(value: string) {
      const made = await migratedDatabase()
      made.raw.prepare("INSERT INTO settings (name, value) VALUES ('notifications', ?)").run(value)
      return loadNotificationSettings(made.db)
    }

    it('take what is missing from the defaults, as a version before the setting existed would have it', async () => {
      expect(await withStored('{"enabled": true}')).toEqual({ ...DEFAULT_NOTIFICATION_SETTINGS, enabled: true })
    })

    it('take the defaults for fields of the wrong kind, and drop what is not an account in the list', async () => {
      const read = await withStored('{"enabled":"yes","preview":1,"mutedAccountIds":["a",3,null,"b"],"intervalMinutes":"soon"}')
      expect(read).toEqual({ ...DEFAULT_NOTIFICATION_SETTINGS, mutedAccountIds: ['a', 'b'] })
    })

    it('are the defaults when the value is not JSON, or not an object', async () => {
      expect(await withStored('not json')).toEqual(DEFAULT_NOTIFICATION_SETTINGS)
      expect(await withStored('[1,2]')).toEqual(DEFAULT_NOTIFICATION_SETTINGS)
      expect(await withStored('null')).toEqual(DEFAULT_NOTIFICATION_SETTINGS)
    })
  })

  it('give the desktop’s rule what it asks for', () => {
    const policy = policyOf({ ...DEFAULT_NOTIFICATION_SETTINGS, enabled: true, mutedAccountIds: ['a'], quietFrom: '22:00', quietTo: '07:00' })
    expect(policy).toEqual({ enabled: true, mutedAccountIds: ['a'], quietFrom: '22:00', quietTo: '07:00' })
  })
})

describe('the settings of the lists', () => {
  it('show the text under the subjects when nothing was set', async () => {
    const { db } = await migratedDatabase()
    expect(await loadListSettings(db)).toEqual(DEFAULT_LIST_SETTINGS)
    expect(DEFAULT_LIST_SETTINGS.showPreview).toBe(true)
  })

  it('come back as they were stored', async () => {
    const { db } = await migratedDatabase()
    expect(await saveListSettings(db, { showPreview: false })).toEqual({ showPreview: false, deviceContacts: false })
    expect(await loadListSettings(db)).toEqual({ showPreview: false, deviceContacts: false })
    await saveListSettings(db, { showPreview: true })
    expect(await loadListSettings(db)).toEqual({ showPreview: true, deviceContacts: false })
  })

  it('keep the switch for the address book apart from the one for the preview', async () => {
    const { db } = await migratedDatabase()
    expect(DEFAULT_LIST_SETTINGS.deviceContacts).toBe(false)
    await saveListSettings(db, { deviceContacts: true })
    expect(await loadListSettings(db)).toEqual({ showPreview: true, deviceContacts: true })
  })

  it('take what is stored that is not a switch for the default, and what is not JSON for nothing set', async () => {
    const { db } = await migratedDatabase()
    await db.run("INSERT INTO settings (name, value) VALUES ('list', ?)", JSON.stringify({ showPreview: 'no' }))
    expect(await loadListSettings(db)).toEqual(DEFAULT_LIST_SETTINGS)
    await db.run("UPDATE settings SET value = 'not json' WHERE name = 'list'")
    expect(await loadListSettings(db)).toEqual(DEFAULT_LIST_SETTINGS)
    await db.run("UPDATE settings SET value = 'null' WHERE name = 'list'")
    expect(await loadListSettings(db)).toEqual(DEFAULT_LIST_SETTINGS)
  })

  it('are kept apart from the notification settings', async () => {
    const { db } = await migratedDatabase()
    await saveListSettings(db, { showPreview: false })
    expect(await loadNotificationSettings(db)).toEqual(DEFAULT_NOTIFICATION_SETTINGS)
  })
})
