import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  DEFAULT_QUIET_HOURS,
  hasQuietHours,
  INTERVAL_CHOICES,
  loadNotificationSettings,
  policyOf,
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
