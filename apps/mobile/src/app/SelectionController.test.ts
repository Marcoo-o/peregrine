import { describe, expect, it } from 'vitest'
import { listFolders } from '../folders'
import { listMessages } from '../messages'
import { appHarness } from '../testing/appHarness'
import type { Picked } from './selection'

const SEEN = '\\Seen'
const STARRED = '\\Flagged'

/** Two accounts: work with an archive and a spam folder, home with neither, and three messages and one. */
async function twoAccounts() {
  const t = await appHarness()
  const work = await t.givenAccount('work', {
    INBOX: [
      { uid: 1, subject: 'one' },
      { uid: 2, subject: 'two', flags: [SEEN] },
      { uid: 3, subject: 'three' }
    ],
    Trash: [],
    Archive: [],
    Junk: []
  })
  const home = await t.givenAccount('home', { INBOX: [{ uid: 1, subject: 'dinner' }], Trash: [] })
  const workInbox = t.folderOf(await listFolders(t.db, work.id), 'INBOX')
  const homeInbox = t.folderOf(await listFolders(t.db, home.id), 'INBOX')
  const pick = (account: { id: string }, folder: { id: string }, ...uids: number[]): Picked[] =>
    uids.map((uid) => ({ accountId: account.id, folderId: folder.id, uid }))
  // The queue reaches the server of an account that is connected, which is what is looked at here.
  await t.app.services.connections.ensure(work)
  await t.app.services.connections.ensure(home)
  t.server.calls.length = 0
  return { ...t, work, home, workInbox, homeInbox, pick }
}

type Both = Awaited<ReturnType<typeof twoAccounts>>

const flagsOf = async (t: Both, folderId: string) =>
  Object.fromEntries((await listMessages(t.db, folderId)).map((message) => [message.uid, message.flags]))

describe('marking several messages read or unread', () => {
  it('adds the flag to each of them, through the queue, and shows the list as it is now', async () => {
    const t = await twoAccounts()
    await t.app.navigator.showMessages(t.work, t.workInbox, { sync: false })

    await t.app.selection.markRead(t.pick(t.work, t.workInbox, 1, 3), true)

    expect(await flagsOf(t, t.workInbox.id)).toMatchObject({ 1: [SEEN], 2: [SEEN], 3: [SEEN] })
    expect(t.server.calls).toEqual(expect.arrayContaining(['add INBOX 1 \\Seen', 'add INBOX 3 \\Seen']))
    expect(t.store.screen).toMatchObject({ name: 'messages', messages: [{ flags: [SEEN] }, { flags: [SEEN] }, { flags: [SEEN] }] })
  })

  it('takes the flag off, and leaves what was not chosen as it was', async () => {
    const t = await twoAccounts()
    await t.app.selection.markRead(t.pick(t.work, t.workInbox, 2), false)
    expect(await flagsOf(t, t.workInbox.id)).toMatchObject({ 1: [], 2: [], 3: [] })
  })

  it('works across accounts in the unified list, one action for each folder', async () => {
    const t = await twoAccounts()
    await t.app.navigator.showUnified({ refresh: false })

    await t.app.selection.markRead([...t.pick(t.work, t.workInbox, 1), ...t.pick(t.home, t.homeInbox, 1)], true)

    expect(await flagsOf(t, t.workInbox.id)).toMatchObject({ 1: [SEEN] })
    expect(await flagsOf(t, t.homeInbox.id)).toMatchObject({ 1: [SEEN] })
    expect(t.store.screen.name).toBe('unified')
  })
})

describe('starring several messages', () => {
  it('stars all of them when not all are starred, so that one tap does one thing', async () => {
    const t = await twoAccounts()
    await t.app.selection.toggleStar(t.pick(t.work, t.workInbox, 1, 2))
    await t.app.selection.toggleStar(t.pick(t.work, t.workInbox, 2, 3))
    expect(await flagsOf(t, t.workInbox.id)).toMatchObject({ 1: [STARRED], 2: [SEEN, STARRED], 3: [STARRED] })
  })

  it('takes the star off all of them when all are starred', async () => {
    const t = await twoAccounts()
    await t.app.selection.toggleStar(t.pick(t.work, t.workInbox, 1, 3))
    await t.app.selection.toggleStar(t.pick(t.work, t.workInbox, 1, 3))
    expect(await flagsOf(t, t.workInbox.id)).toMatchObject({ 1: [], 3: [] })
  })
})

describe('putting several messages away', () => {
  it('moves them to the archive of their account and shows the list without them going away at once', async () => {
    const t = await twoAccounts()
    await t.app.navigator.showMessages(t.work, t.workInbox, { sync: false })

    const notice = await t.app.selection.archive(t.pick(t.work, t.workInbox, 1, 3))

    expect(notice).toBeUndefined()
    expect(t.server.calls).toContain('move INBOX > Archive 1,3')
  })

  it('moves them to the spam folder', async () => {
    const t = await twoAccounts()
    await t.app.selection.markAsJunk(t.pick(t.work, t.workInbox, 2))
    expect(t.server.calls).toContain('move INBOX > Junk 2')
  })

  it('leaves alone those of an account that has no archive, and says which account that is', async () => {
    const t = await twoAccounts()
    const notice = await t.app.selection.archive([...t.pick(t.work, t.workInbox, 1), ...t.pick(t.home, t.homeInbox, 1)])
    expect(t.server.calls.filter((call) => call.startsWith('move'))).toEqual(['move INBOX > Archive 1'])
    expect(notice).toBe('Für home@example.org ist kein Archivordner vorhanden')
  })

  it('says so for the spam folder in its own words', async () => {
    const t = await twoAccounts()
    const notice = await t.app.selection.markAsJunk(t.pick(t.home, t.homeInbox, 1))
    expect(notice).toBe('Für home@example.org ist kein Spam-Ordner vorhanden')
  })

  it('deletes them into the trash of each account', async () => {
    const t = await twoAccounts()
    await t.app.navigator.showUnified({ refresh: false })
    await t.app.selection.remove([...t.pick(t.work, t.workInbox, 3), ...t.pick(t.home, t.homeInbox, 1)])
    expect(t.server.calls).toEqual(expect.arrayContaining(['move INBOX > Trash 3', 'move INBOX > Trash 1']))
  })
})

describe('what is chosen that is not there any more', () => {
  it('is left out, and what is there is still done', async () => {
    const t = await twoAccounts()
    await t.app.selection.markRead([...t.pick(t.work, t.workInbox, 1), { accountId: t.work.id, folderId: 'gone', uid: 1 }], true)
    expect(await flagsOf(t, t.workInbox.id)).toMatchObject({ 1: [SEEN] })
  })

  it('is nothing to do when nothing is chosen', async () => {
    const t = await twoAccounts()
    await expect(t.app.selection.markRead([], true)).resolves.toBeUndefined()
    expect(t.server.calls).toEqual([])
  })
})
