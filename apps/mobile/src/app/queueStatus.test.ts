import { describe, expect, it } from 'vitest'
import { emptySummary, MAX_ATTEMPTS, type PendingSummary } from '@peregrine/core/pendingActions'
import { listFolders } from '../folders'
import { appHarness } from '../testing/appHarness'
import { failedText, isOnline, refreshQueueStatus, waitingText } from './queueStatus'

/** As the store makes it: what was given up on is in `failed` and not in `total`. */
const summary = (total: number, failed = 0, drafts = 0): PendingSummary => ({
  ...emptySummary(),
  total,
  failed,
  byKind: { ...emptySummary().byKind, saveDraft: drafts }
})

describe('what waits', () => {
  it('is said in the singular and the plural, and not at all when nothing waits', () => {
    expect(waitingText(summary(0))).toBeNull()
    expect(waitingText(summary(1))).toBe('1 Aktion wartet')
    expect(waitingText(summary(3))).toBe('3 Aktionen warten')
  })

  it('does not count what was given up on, which is said apart', () => {
    expect(waitingText(summary(0, 2))).toBeNull()
    expect(waitingText(summary(3, 1))).toBe('3 Aktionen warten')
  })

  it('names a draft that waits to be kept, and says so alone when nothing else waits', () => {
    expect(waitingText(summary(1, 0, 1))).toBe('1 Entwurf wartet')
    expect(waitingText(summary(2, 0, 2))).toBe('2 Entwürfe warten')
    expect(waitingText(summary(3, 0, 1))).toBe('3 Aktionen warten, davon 1 Entwurf')
    expect(waitingText(summary(4, 0, 2))).toBe('4 Aktionen warten, davon 2 Entwürfe')
  })
})

describe('what was given up on', () => {
  it('is said in the singular and the plural, and not at all when nothing was', () => {
    expect(failedText(summary(0))).toBeNull()
    expect(failedText(summary(1, 1))).toBe('1 Aktion ist fehlgeschlagen.')
    expect(failedText(summary(4, 2))).toBe('2 Aktionen sind fehlgeschlagen.')
  })
})

describe('reading the status into the store', () => {
  async function withWaitingAction() {
    const t = await appHarness()
    const work = await t.givenAccount('work', { INBOX: [{ uid: 1 }], Trash: [] })
    const folder = t.folderOf(await listFolders(t.db, work.id), 'INBOX')
    await t.app.services.mail.setFlags(folder, [1], ['\\Seen'], [])
    return { ...t, work }
  }

  it('counts what waits, and gives the reason the server refused it for the account the line speaks of', async () => {
    const t = await withWaitingAction()
    await t.app.services.connections.ensure(t.work)
    t.server.refuseFlags = 'NO [CANNOT] not allowed'
    t.store.setStatusAccount(t.work.id)
    const folder = t.folderOf(await listFolders(t.db, t.work.id), 'INBOX')
    await t.app.services.mail.setFlags(folder, [1], ['\\Flagged'], [])

    await refreshQueueStatus(t.app.services, t.store)

    expect(t.store.state.waiting?.summary.total).toBe(2)
    expect(t.store.state.waiting?.problem).toBe('NO [CANNOT] not allowed')
  })

  it('says what waits without what was given up on, which the store keeps apart', async () => {
    const t = await withWaitingAction()
    await t.db.run('UPDATE pending_actions SET attempts = ?', MAX_ATTEMPTS)
    const folder = t.folderOf(await listFolders(t.db, t.work.id), 'INBOX')
    await t.app.services.mail.setFlags(folder, [1], ['\Flagged'], [])

    await refreshQueueStatus(t.app.services, t.store)

    const waiting = t.store.state.waiting!.summary
    expect(waiting).toMatchObject({ total: 1, failed: 1 })
    expect(waitingText(waiting)).toBe('1 Aktion wartet')
    expect(failedText(waiting)).toBe('1 Aktion ist fehlgeschlagen.')
  })

  it('has no reason when the line speaks of all accounts', async () => {
    const t = await withWaitingAction()
    t.store.setStatusAccount(null)
    await refreshQueueStatus(t.app.services, t.store)
    expect(t.store.state.waiting?.problem).toBeNull()
  })
})

describe('whether the line is about something connected', () => {
  it('is the account it speaks of when it speaks of one', () => {
    expect(isOnline({ connected: ['a', 'b'], statusAccountId: 'a' })).toBe(true)
    expect(isOnline({ connected: ['b'], statusAccountId: 'a' })).toBe(false)
  })

  it('is any account when it speaks of all of them', () => {
    expect(isOnline({ connected: ['b'], statusAccountId: null })).toBe(true)
    expect(isOnline({ connected: [], statusAccountId: null })).toBe(false)
  })
})

describe('giving up on what failed', () => {
  it('removes it from the count and reads what is left', async () => {
    const t = await appHarness()
    const work = await t.givenAccount('work', { INBOX: [{ uid: 1 }], Trash: [] })
    const folder = t.folderOf(await listFolders(t.db, work.id), 'INBOX')
    await t.app.services.connections.ensure(work)
    t.server.refuseFlags = 'NO not allowed'
    await t.app.services.mail.setFlags(folder, [1], ['\\Seen'], [])
    for (let attempt = 0; attempt < 4; attempt++) await t.app.services.mail.flush(work.id)
    await refreshQueueStatus(t.app.services, t.store)
    expect(t.store.state.waiting?.summary.failed).toBe(1)

    await t.app.discardFailedActions()

    expect(t.store.state.waiting?.summary).toMatchObject({ total: 0, failed: 0 })
  })
})
