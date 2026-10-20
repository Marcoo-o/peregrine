import { describe, expect, it } from 'vitest'
import { listFolders } from '../folders'
import { saveNotificationSettings, type NotificationSettings } from '../settings'
import { appHarness } from '../testing/appHarness'
import { runBackgroundSync } from './backgroundSync'
import type { MailNotification, Notifier } from './notifications'

const noon = new Date(2026, 9, 20, 12, 0)

/** A notifier that keeps what it was asked to show. */
class RecordingNotifier implements Notifier {
  readonly shown: MailNotification[] = []
  failFor: string | null = null

  async show(notification: MailNotification): Promise<void> {
    if (notification.accountId === this.failFor) throw new Error('the system refused')
    this.shown.push(notification)
  }
}

async function twoAccounts(settings: Partial<NotificationSettings> = { enabled: true }) {
  const t = await appHarness()
  const work = await t.givenAccount('work', { INBOX: [{ uid: 1, subject: 'Old at work' }], Trash: [] })
  const home = await t.givenAccount('home', { INBOX: [{ uid: 1, subject: 'Old at home' }], Trash: [] })
  await saveNotificationSettings(t.db, settings)
  const notifier = new RecordingNotifier()
  const run = (over: { foreground?: boolean; now?: Date } = {}) =>
    runBackgroundSync({
      services: t.app.services,
      notifier,
      isForeground: () => over.foreground ?? false,
      log: t.app.services.log,
      now: () => over.now ?? noon
    })
  const arrive = (user: string, uid: number, subject: string) =>
    t.server.mailboxes.get(user)!.INBOX.push({ uid, subject, date: new Date(Date.UTC(2026, 9, 20)) })
  return { ...t, work, home, notifier, run, arrive }
}

describe('looking for new mail in the background', () => {
  it('does nothing, and asks no server, while notifications are off', async () => {
    const t = await twoAccounts({ enabled: false })
    t.arrive('work', 2, 'New')
    expect(await t.run()).toMatchObject({ skipped: 'disabled', notified: 0 })
    expect(t.server.sessions).toHaveLength(0)
    expect(t.notifier.shown).toEqual([])
  })

  it('does nothing while the application is on the screen, which brings itself up to date', async () => {
    const t = await twoAccounts()
    t.arrive('work', 2, 'New')
    expect(await t.run({ foreground: true })).toMatchObject({ skipped: 'foreground' })
    expect(t.server.sessions).toHaveLength(0)
  })

  it('announces a message that arrived, with who wrote and what about', async () => {
    const t = await twoAccounts()
    t.arrive('work', 2, 'Budget for next quarter')

    const result = await t.run()

    expect(result).toEqual({ synced: 2, failed: 0, notified: 1 })
    expect(t.notifier.shown).toHaveLength(1)
    expect(t.notifier.shown[0]).toMatchObject({
      accountId: t.work.id,
      title: 'sender@example.net',
      body: 'Budget for next quarter',
      subtitle: 'work',
      target: { accountId: t.work.id, uid: 2 }
    })
  })

  it('announces it once, and a run after that finds nothing new', async () => {
    const t = await twoAccounts()
    t.arrive('work', 2, 'New')
    await t.run()
    expect(await t.run()).toMatchObject({ notified: 0 })
    expect(t.notifier.shown).toHaveLength(1)
  })

  it('does not announce a message the user has seen in the application', async () => {
    const t = await twoAccounts()
    t.arrive('work', 2, 'New')
    // the user opened the account and its inbox, which brought the message into the application, and
    // then the background run came
    await t.app.navigator.openAccount(t.work)
    const inbox = t.folderOf(await listFolders(t.db, t.work.id), 'INBOX')
    await t.app.navigator.showMessages(t.work, inbox, { sync: true })
    t.app.services.connections.dropAll()
    expect(await t.run()).toMatchObject({ notified: 0 })
  })

  it('does not announce what another client has read already', async () => {
    const t = await twoAccounts()
    t.server.mailboxes.get('work')!.INBOX.push({ uid: 2, subject: 'Read elsewhere', flags: ['\\Seen'] })
    expect(await t.run()).toMatchObject({ notified: 0 })
  })

  it('tells for each account, one notification each', async () => {
    const t = await twoAccounts()
    t.arrive('work', 2, 'One')
    t.arrive('work', 3, 'Two')
    t.arrive('home', 2, 'Three')
    expect(await t.run()).toMatchObject({ notified: 2 })
    expect(t.notifier.shown.map((n) => [n.accountId === t.work.id ? 'work' : 'home', n.count])).toEqual([
      ['work', 2],
      ['home', 1]
    ])
  })

  it('does not even connect an account that is muted, and tells for the others', async () => {
    const t = await twoAccounts({ enabled: true })
    await saveNotificationSettings(t.db, { mutedAccountIds: [t.work.id] })
    t.arrive('work', 2, 'Quiet')
    t.arrive('home', 2, 'Heard')

    const result = await t.run()

    expect(result.notified).toBe(1)
    expect(t.notifier.shown[0].accountId).toBe(t.home.id)
    expect(t.server.sessions).toHaveLength(1)
  })

  it('does nothing in the quiet hours, across midnight, and connects no account', async () => {
    const t = await twoAccounts({ enabled: true, quietFrom: '22:00', quietTo: '07:00' })
    t.arrive('work', 2, 'At night')
    expect(await t.run({ now: new Date(2026, 9, 20, 23, 30) })).toMatchObject({ skipped: 'nothing to do' })
    expect(t.server.sessions).toHaveLength(0)
    // it is found when the quiet hours are over
    expect(await t.run({ now: new Date(2026, 9, 21, 7, 5) })).toMatchObject({ notified: 1 })
  })

  it('tells for the accounts that could be reached when one cannot, and counts the one that could not', async () => {
    const t = await twoAccounts()
    t.server.unreachable.add('home')
    t.arrive('work', 2, 'Reached')
    t.arrive('home', 2, 'Not reached')

    expect(await t.run()).toEqual({ synced: 1, failed: 1, notified: 1 })
    expect(t.logs.some((line) => line.includes('home') && line.includes('could not be brought up to date'))).toBe(true)
  })

  it('goes on with the other notifications when one cannot be shown, and says so', async () => {
    const t = await twoAccounts()
    t.notifier.failFor = t.work.id
    t.arrive('work', 2, 'Not shown')
    t.arrive('home', 2, 'Shown')

    expect(await t.run()).toMatchObject({ notified: 1 })
    expect(t.notifier.shown.map((n) => n.accountId)).toEqual([t.home.id])
    expect(t.logs.some((line) => line.includes('the system refused'))).toBe(true)
  })

  it('lets go of its connections when it is done, and when it failed', async () => {
    const t = await twoAccounts()
    t.arrive('work', 2, 'New')
    await t.run()
    expect(t.app.services.connections.connectedIds).toEqual([])
    expect(t.server.calls.filter((call) => call.startsWith('disconnect')).length).toBeGreaterThan(0)
  })

  it('replays what the user decided while there was no connection, before it reads the mail', async () => {
    const t = await twoAccounts()
    const folder = t.folderOf(await listFolders(t.db, t.work.id), 'INBOX')
    await t.app.services.mail.setFlags(folder, [1], ['\\Flagged'], [])
    t.server.calls.length = 0

    await t.run()

    expect(t.server.calls).toContain('add INBOX 1 \\Flagged')
  })

  it('has nothing to do with no account at all', async () => {
    const t = await appHarness()
    await saveNotificationSettings(t.db, { enabled: true })
    const result = await runBackgroundSync({
      services: t.app.services,
      notifier: new RecordingNotifier(),
      isForeground: () => false,
      log: t.app.services.log,
      now: () => noon
    })
    expect(result).toMatchObject({ skipped: 'nothing to do' })
  })
})
