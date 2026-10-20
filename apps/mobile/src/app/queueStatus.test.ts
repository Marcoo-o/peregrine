import { describe, expect, it } from 'vitest'
import { emptySummary, type PendingSummary } from '@peregrine/core/pendingActions'
import { listFolders } from '../folders'
import { appHarness } from '../testing/appHarness'
import { failedText, isOnline, refreshQueueStatus, waitingText } from './queueStatus'

const summary = (total: number, failed = 0): PendingSummary => ({ ...emptySummary(), total, failed })

describe('what waits', () => {
  it('is said in the singular and the plural, and not at all when nothing waits', () => {
    expect(waitingText(summary(0))).toBeNull()
    expect(waitingText(summary(1))).toBe('1 Aktion wartet')
    expect(waitingText(summary(3))).toBe('3 Aktionen warten')
  })

  it('does not count what was given up on, which is said apart', () => {
    expect(waitingText(summary(2, 2))).toBeNull()
    expect(waitingText(summary(3, 1))).toBe('2 Aktionen warten')
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
