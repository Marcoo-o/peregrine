import { describe, expect, it } from 'vitest'
import { listFolders } from '../folders'
import type { Incoming } from '../incoming'
import { saveNotificationSettings } from '../settings'
import { appHarness, eventually } from '../testing/appHarness'

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

describe('what waits for a connection', () => {
  const markRead = (t: Awaited<ReturnType<typeof withMessage>>) => t.app.services.mail.setFlags(t.folder, [1], ['\Seen'], [])

  it('goes out by itself once the server can be reached, without anybody opening anything', async () => {
    const t = await withMessage()
    t.server.unreachable.add('work')
    await markRead(t)
    expect(t.server.calls).toEqual([])
    expect(t.reconnectTimers.pending.size).toBe(1)

    await t.reconnectTimers.fire()
    expect(t.server.calls).toEqual([])
    expect(t.reconnectTimers.pending.size).toBe(1)

    t.server.unreachable.delete('work')
    await t.reconnectTimers.fire()
    expect(t.server.calls).toEqual(['add INBOX 1 \Seen'])
    expect(t.store.state.connected).toEqual([t.work.id])
  })

  it('is tried at once when the application comes to the front', async () => {
    const t = await withMessage()
    t.server.unreachable.add('work')
    await markRead(t)
    t.server.unreachable.delete('work')

    await t.app.comeToFront()
    expect(t.server.calls).toEqual(['add INBOX 1 \Seen'])
  })

  it('connects again after the connection was lost while something waits', async () => {
    const t = await withMessage()
    await t.app.services.connections.ensure(t.work)
    t.server.sessions[0].end()
    t.server.unreachable.add('work')
    t.app.services.mail.setFlags(t.folder, [1], ['\Seen'], []).catch(() => undefined)
    await eventuallyPending(t)

    t.server.unreachable.delete('work')
    await t.reconnectTimers.fire()
    expect(t.server.calls).toContain('add INBOX 1 \Seen')
  })

  it('does not keep a connection up for an account that nothing waits for', async () => {
    const t = await withMessage()
    await t.app.services.connections.ensure(t.work)
    t.server.sessions[0].end()
    await t.reconnectTimers.fire()
    expect(t.server.sessions).toHaveLength(1)
    expect(t.store.state.connected).toEqual([])
  })

  it('leaves no timer behind when the application is stopped', async () => {
    const t = await withMessage()
    t.server.unreachable.add('work')
    await markRead(t)
    t.app.stop()
    expect(t.reconnectTimers.pending.size).toBe(0)
  })
})

async function eventuallyPending(t: { reconnectTimers: { pending: Map<number, unknown> } }): Promise<void> {
  await eventually(() => expect(t.reconnectTimers.pending.size).toBeGreaterThan(0))
}

describe('what another application asks of this one', () => {
  const asked = (over: Partial<Incoming> = {}): Incoming => ({ mailto: null, subject: '', text: '', to: [], cc: [], bcc: [], files: [], unreadable: 0, ...over })

  it('starts a message from a link to an address, written from the account, over the screen that was shown', async () => {
    const t = await withMessage()
    await t.app.start()
    const before = t.store.screen
    t.files.incoming = asked({ mailto: 'mailto:sam@example.org?subject=Hi&body=Hello' })

    await t.app.comeToFront()

    expect(t.store.screen).toMatchObject({
      name: 'compose',
      account: { id: t.work.id },
      draft: { to: 'sam@example.org', subject: 'Hi', body: 'Hello' },
      returnTo: before
    })
    // it was given once
    expect(await t.files.consumeIncoming()).toBeNull()
  })

  it('starts a message from what was shared, with its files attached and the ones too large said and removed', async () => {
    const t = await withMessage()
    await t.app.start()
    t.files.incoming = asked({
      text: 'https://example.org/page',
      subject: 'A page',
      files: [
        { path: '/store/1/a.pdf', name: 'a.pdf', size: 10, contentType: 'application/pdf' },
        { path: '/store/2/big.bin', name: 'big.bin', size: 30 * 1024 * 1024, contentType: 'application/octet-stream' }
      ]
    })
    await t.app.openIncoming()
    expect(t.store.screen).toMatchObject({
      name: 'compose',
      draft: { subject: 'A page', body: 'https://example.org/page', attachments: [{ filename: 'a.pdf' }] },
      error: expect.stringContaining('big.bin')
    })
    expect(t.files.removed).toEqual(['/store/2/big.bin'])
  })

  it('writes from the first account that can send', async () => {
    const t = await appHarness()
    await t.givenAccount('reader', { INBOX: [] }, { smtpHost: null, smtpPort: null, smtpSecure: null })
    const sender = await t.givenAccount('sender', { INBOX: [] }, { smtpHost: 'smtp.example.org', smtpPort: 587, smtpSecure: 'starttls' })
    t.files.incoming = asked({ mailto: 'mailto:sam@example.org' })
    await t.app.openIncoming()
    expect(t.store.screen).toMatchObject({ name: 'compose', account: { id: sender.id } })
  })

  it('leaves a message that is being written alone, and keeps the request for the next time', async () => {
    const t = await withMessage()
    await t.app.start()
    t.app.compose.startNew(t.work, t.store.screen)
    const writing = t.store.screen
    t.files.incoming = asked({ mailto: 'mailto:sam@example.org' })

    await t.app.openIncoming()
    expect(t.store.screen).toBe(writing)

    t.store.showScreen({ name: 'login' })
    await t.app.openIncoming()
    expect(t.store.screen).toMatchObject({ name: 'compose', draft: { to: 'sam@example.org' } })
  })

  it('does nothing without an account, and removes the files that came', async () => {
    const t = await appHarness()
    t.files.incoming = asked({ files: [{ path: '/store/1/a.pdf', name: 'a.pdf', size: 1, contentType: 'application/pdf' }] })
    await t.app.openIncoming()
    expect(t.store.screen.name).not.toBe('compose')
    expect(t.files.removed).toEqual(['/store/1/a.pdf'])
  })

  it('goes on when the platform cannot say, and says so', async () => {
    const t = await withMessage()
    t.files.consumeIncoming = async () => {
      throw new Error('no module')
    }
    await expect(t.app.openIncoming()).resolves.toBeUndefined()
    expect(t.logs.some((line) => line.includes('no module'))).toBe(true)
  })
})
