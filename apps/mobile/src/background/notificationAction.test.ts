import { describe, expect, it } from 'vitest'
import { getAccount } from '../accounts'
import { SEEN } from '../flags'
import { listFolders } from '../folders'
import { getMessage } from '../messages'
import { appHarness } from '../testing/appHarness'
import { runNotificationAction } from './notificationAction'

async function withMessage(folders: Record<string, never[]> = { Archive: [], Trash: [] }) {
  const t = await appHarness()
  const work = await t.givenAccount('work', { INBOX: [{ uid: 5, subject: 'Budget' }], ...folders })
  const inbox = t.folderOf(await listFolders(t.db, work.id), 'INBOX')
  const target = { accountId: work.id, folderId: inbox.id, uid: 5 }
  const run = (action: 'archive' | 'read', over: { target?: typeof target; connectTimeoutMs?: number } = {}) =>
    runNotificationAction({ services: t.app.services, log: t.app.services.log, connectTimeoutMs: over.connectTimeoutMs }, action, over.target ?? target)
  return { ...t, work, inbox, target, run }
}

describe('the buttons of a notification', () => {
  it('mark the message read here and on the server', async () => {
    const t = await withMessage()
    expect(await t.run('read')).toBe('done')
    expect((await getMessage(t.db, t.inbox.id, 5))?.flags).toContain(SEEN)
    expect(t.server.calls).toContain(`add INBOX 5 ${SEEN}`)
  })

  it('archive the message: it goes to the archive folder through the queue', async () => {
    const t = await withMessage()
    expect(await t.run('archive')).toBe('done')
    expect(t.server.calls).toContain('move INBOX > Archive 5')
  })

  it('say that there is no archive folder, and change nothing', async () => {
    const t = await withMessage({ Trash: [] })
    expect(await t.run('archive')).toBe('no archive folder')
    expect(t.server.calls).toEqual([])
    expect((await getMessage(t.db, t.inbox.id, 5))?.pendingMoveTo ?? null).toBeNull()
  })

  it('say that the message is gone when the application does not have it any more', async () => {
    const t = await withMessage()
    expect(await t.run('read', { target: { ...t.target, uid: 99 } })).toBe('message gone')
    expect(await t.run('read', { target: { ...t.target, folderId: 'nowhere' } })).toBe('message gone')
  })

  it('keep the change for the next connection when there is none: it is made here and waits in the queue', async () => {
    const t = await withMessage()
    t.server.unreachable.add('work')
    expect(await t.run('read')).toBe('queued')
    expect((await getMessage(t.db, t.inbox.id, 5))?.flags).toContain(SEEN)
    expect(t.server.calls).toEqual([])
    // and the next connection tells the server
    t.server.unreachable.clear()
    await t.app.services.connections.ensure((await getAccount(t.db, t.work.id))!)
    await t.app.services.mail.flush(t.work.id)
    expect(t.server.calls).toContain(`add INBOX 5 ${SEEN}`)
  })

  it('let go of the connection when they are done', async () => {
    const t = await withMessage()
    await t.run('read')
    expect(t.app.services.connections.get(t.work.id)).toBeNull()
  })
})
