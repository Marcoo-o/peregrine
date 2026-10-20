import { describe, expect, it } from 'vitest'
import { listFolders } from '../folders'
import { saveNotificationSettings } from '../settings'
import { appHarness } from '../testing/appHarness'

async function withMessage() {
  const t = await appHarness()
  const work = await t.givenAccount('work', { INBOX: [{ uid: 1, subject: 'Budget', source: 'Subject: Budget\r\n\r\nText' }], Trash: [] })
  const folder = t.folderOf(await listFolders(t.db, work.id), 'INBOX')
  return { ...t, work, folder }
}

describe('starting the application', () => {
  it('has the platform look for new mail every so often when notifications are on', async () => {
    const t = await withMessage()
    await saveNotificationSettings(t.db, { enabled: true, intervalMinutes: 60 })
    await t.app.start()
    expect(t.syncSchedule.calls).toEqual(['schedule 60'])
  })

  it('has it stop when notifications are off, which is right after an update or a reinstall too', async () => {
    const t = await withMessage()
    await t.app.start()
    expect(t.syncSchedule.calls).toEqual(['cancel'])
  })

  it('shows the first screen though the platform could not be given the schedule', async () => {
    const t = await withMessage()
    t.syncSchedule.failWith = new Error('no scheduler')
    await t.app.start()
    expect(t.store.screen.name).toBe('folders')
  })

  it('opens the message a notification was tapped for when that is what started it', async () => {
    const t = await withMessage()
    t.notifications.launchTargets.push({ accountId: t.work.id, folderId: t.folder.id, uid: 1 })
    await t.app.start()
    expect(t.store.screen).toMatchObject({ name: 'message', summary: { subject: 'Budget' } })
  })

  it('shows only the first screen when nothing was tapped', async () => {
    const t = await withMessage()
    await t.app.start()
    expect(t.store.screen.name).toBe('folders')
  })
})

describe('the application coming to the front', () => {
  it('opens the message a notification was tapped for, once', async () => {
    const t = await withMessage()
    await t.app.start()
    t.notifications.launchTargets.push({ accountId: t.work.id, folderId: t.folder.id, uid: 1 })

    await t.app.openLaunchTarget()
    expect(t.store.screen.name).toBe('message')

    t.store.showScreen({ name: 'login' })
    await t.app.openLaunchTarget()
    expect(t.store.screen.name).toBe('login')
  })

  it('goes on when the platform cannot say, and says so', async () => {
    const t = await withMessage()
    t.notifications.consumeLaunchTarget = async () => {
      throw new Error('no module')
    }
    await expect(t.app.openLaunchTarget()).resolves.toBeUndefined()
    expect(t.logs.some((line) => line.includes('no module'))).toBe(true)
  })
})
