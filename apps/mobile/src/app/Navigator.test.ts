import { describe, expect, it } from 'vitest'
import { listAccounts } from '../accounts'
import { listFolders } from '../folders'
import { appHarness, eventually } from '../testing/appHarness'
import type { Screen } from './screens'

const day = (n: number) => new Date(Date.UTC(2026, 9, n))

/** Two accounts with two messages each, one of them with a message the other has not. */
async function twoAccounts() {
  const t = await appHarness()
  const work = await t.givenAccount('work', {
    INBOX: [{ uid: 1, subject: 'Budget', date: day(1), source: 'Subject: Budget\r\n\r\nText' }],
    Trash: []
  })
  const home = await t.givenAccount('home', { INBOX: [{ uid: 1, subject: 'Dinner', date: day(2) }], Trash: [] })
  return { ...t, work, home }
}

const screenName = (screen: Screen) => screen.name

describe('the first screen', () => {
  it('is the form when there is no account', async () => {
    const t = await appHarness()
    await t.app.navigator.start()
    expect(t.store.screen).toEqual({ name: 'login', error: undefined })
  })

  it('is the folders of the account when there is one', async () => {
    const t = await appHarness()
    const work = await t.givenAccount('work', { INBOX: [], Trash: [] })
    await t.app.navigator.start()
    expect(t.store.screen).toMatchObject({ name: 'folders', account: { id: work.id } })
    expect(t.store.state.connected).toEqual([work.id])
  })

  it('is the unified inbox when there are two, brought up to date from both', async () => {
    const t = await twoAccounts()
    t.server.mailboxes.get('work')?.INBOX.push({ uid: 2, subject: 'New at work', date: day(5) })
    await t.app.navigator.start()
    const screen = t.store.screen
    expect(screen.name).toBe('unified')
    if (screen.name !== 'unified') return
    expect(screen.busy).toBe(false)
    expect(screen.messages.map((m) => m.subject)).toEqual(['New at work', 'Dinner', 'Budget'])
    expect(t.store.state.statusAccountId).toBeNull()
  })
})

describe('the folders of an account', () => {
  it('say how many messages of each are not read', async () => {
    const t = await appHarness()
    const seen = ['\\Seen']
    const work = await t.givenAccount('work', {
      INBOX: [{ uid: 1 }, { uid: 2 }, { uid: 3, flags: seen }],
      Trash: [{ uid: 1, flags: seen }]
    })
    await t.app.navigator.openAccount(work)

    const screen = t.store.screen
    if (screen.name !== 'folders') throw new Error(`not the folders but ${screen.name}`)
    const inbox = screen.folders.find((folder) => folder.imapPath === 'INBOX')
    expect(screen.unread).toEqual({ [inbox?.id ?? '']: 2 })
  })
})

describe('opening an account', () => {
  it('shows its folders from the server, after what waited in the queue was replayed', async () => {
    const t = await appHarness()
    const work = await t.givenAccount('work', { INBOX: [{ uid: 1 }], Trash: [] })
    const folders = await listFolders(t.db, work.id)
    await t.app.services.mail.setFlags(folders[0], [1], ['\\Seen'], [])
    t.server.calls.length = 0
    t.app.services.connections.drop(work.id)

    await t.app.services.mail.setFlags(folders[0], [1], ['\\Flagged'], [])
    await t.app.navigator.openAccount(work)

    expect(t.server.calls).toContain('add INBOX 1 \\Flagged')
    expect(t.store.screen.name).toBe('folders')
    expect(t.store.state.statusAccountId).toBe(work.id)
  })

  it('shows the folders it has from before, with the reason, when the server cannot be reached', async () => {
    const t = await appHarness()
    const work = await t.givenAccount('work', { INBOX: [], Trash: [] })
    t.server.unreachable.add('work')
    await t.app.navigator.openAccount(work)
    expect(t.store.screen).toMatchObject({ name: 'folders', offline: 'Der Server ist nicht erreichbar. (work: connection refused)' })
  })

  it('goes back to the list of accounts, naming the account, when there is nothing from before either', async () => {
    const t = await appHarness()
    const work = await t.givenAccount('work', {})
    const other = await t.givenAccount('other', { INBOX: [] })
    t.server.unreachable.add('work')
    await t.app.navigator.openAccount(work)
    expect(t.store.screen).toMatchObject({ name: 'accounts', error: 'work: Der Server ist nicht erreichbar. (work: connection refused)' })
    expect((t.store.screen as { accounts: unknown[] }).accounts).toHaveLength(2)
    expect(other.id).toBeTruthy()
  })

  it('shows the stored folders again without asking the server', async () => {
    const t = await appHarness()
    const work = await t.givenAccount('work', { INBOX: [], Trash: [] })
    await t.app.navigator.showStoredFolders(work)
    expect(t.store.screen).toMatchObject({ name: 'folders' })
    expect(t.server.sessions).toHaveLength(0)
  })
})

describe('the list of accounts and the form', () => {
  it('shows the form when the last account is gone', async () => {
    const t = await appHarness()
    await t.app.navigator.showAccounts('gone')
    expect(t.store.screen).toEqual({ name: 'login', error: 'gone' })
  })

  it('leaves the form for the accounts only when there are some', async () => {
    const t = await appHarness()
    t.app.navigator.showLogin()
    expect(await t.app.navigator.leaveLogin()).toBe(false)
    expect(t.store.screen.name).toBe('login')

    await t.givenAccount('work', { INBOX: [] })
    expect(await t.app.navigator.leaveLogin()).toBe(true)
    expect(t.store.screen.name).toBe('accounts')
  })
})

describe('the unified inbox', () => {
  it('is shown from what is stored when it is not asked to refresh, and asks no server', async () => {
    const t = await twoAccounts()
    await t.app.navigator.showUnified({ refresh: false })
    expect(t.store.screen).toMatchObject({ name: 'unified', busy: false })
    expect(t.server.sessions).toHaveLength(0)
  })

  it('gets the first of the text of its messages under their subjects once it has been fetched', async () => {
    const t = await twoAccounts()
    await t.app.navigator.showUnified({ refresh: true })
    await eventually(() => {
      const shown = t.store.screen
      if (shown.name !== 'unified') throw new Error('not the unified inbox')
      expect(shown.messages.map((m) => [m.subject, m.preview])).toEqual([
        ['Dinner', ''],
        ['Budget', 'Text']
      ])
    })
  })

  it('is shown at once from what is stored and then brought up to date, with the accounts that failed named', async () => {
    const t = await twoAccounts()
    t.server.unreachable.add('home')
    const seen: Screen[] = []
    let previous = t.store.screen
    t.store.subscribe(() => {
      if (t.store.screen === previous) return
      previous = t.store.screen
      seen.push(previous)
    })

    await t.app.navigator.showUnified({ refresh: true })

    expect(seen[0]).toMatchObject({ name: 'unified', busy: true, problems: [] })
    const last = t.store.screen
    expect(last).toMatchObject({ name: 'unified', busy: false })
    if (last.name !== 'unified') return
    expect(last.problems).toEqual([expect.objectContaining({ accountName: 'home', error: 'Der Server ist nicht erreichbar. (home: connection refused)' })])
  })

  // Found on an emulator: after an action the way back to the list did not show it, because the
  // update that follows a fetch was held back when the list was not on the screen.
  it('is shown when it is gone to from another screen, though it is not on the screen yet', async () => {
    const t = await twoAccounts()
    t.store.showScreen({ name: 'login' })
    await t.app.navigator.showUnified({ refresh: false })
    expect(screenName(t.store.screen)).toBe('unified')
  })

  it('is not put over a screen the user went to while the accounts were being fetched', async () => {
    const t = await twoAccounts()
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    const connect = t.app.services.connectImap
    t.app.services.connections.ensure = async (account) => {
      await held
      return (await connect({ username: account.imapUsername } as never)) as never
    }

    const refreshing = t.app.navigator.showUnified({ refresh: true })
    await new Promise((resolve) => setTimeout(resolve, 5))
    t.app.navigator.showLogin()
    release()
    await refreshing

    expect(t.store.screen.name).toBe('login')
  })
})

describe('the messages of a folder', () => {
  async function inbox() {
    const t = await appHarness()
    const work = await t.givenAccount('work', { INBOX: [{ uid: 1, subject: 'One' }, { uid: 2, subject: 'Two' }], Trash: [] })
    const folder = t.folderOf(await listFolders(t.db, work.id), 'INBOX')
    return { ...t, work, folder }
  }

  it('are the stored ones, without a word to the server, when not asked to sync', async () => {
    const t = await inbox()
    await t.app.navigator.showMessages(t.work, t.folder, { sync: false })
    expect(t.store.screen).toMatchObject({ name: 'messages', busy: false })
    expect(t.server.sessions).toHaveLength(0)
  })

  it('are brought up to date from the server when it is connected, first showing what is stored', async () => {
    const t = await inbox()
    await t.app.services.connections.ensure(t.work)
    t.server.mailboxes.get('work')?.INBOX.push({ uid: 3, subject: 'Three' })
    const seen: Screen[] = []
    t.store.subscribe(() => seen.push(t.store.screen))

    await t.app.navigator.showMessages(t.work, t.folder, { sync: true })

    expect(seen[0]).toMatchObject({ name: 'messages', busy: true })
    const last = t.store.screen
    if (last.name !== 'messages') throw new Error('not the messages')
    expect(last.busy).toBe(false)
    expect(last.messages.map((m) => m.uid)).toEqual([3, 2, 1])
  })

  it('get the first of their text under the subject once it has been fetched, after the list was shown', async () => {
    const t = await appHarness()
    const work = await t.givenAccount('work', {
      INBOX: [
        { uid: 1, subject: 'One', source: 'Subject: One\r\n\r\nShall we meet on Friday?' },
        { uid: 2, subject: 'Two' }
      ],
      Trash: []
    })
    const folder = t.folderOf(await listFolders(t.db, work.id), 'INBOX')
    await t.app.services.connections.ensure(work)

    await t.app.navigator.showMessages(work, folder, { sync: true })
    expect(t.store.screen).toMatchObject({ name: 'messages', busy: false })

    await eventually(() => {
      const shown = t.store.screen
      if (shown.name !== 'messages') throw new Error('not the messages')
      expect(shown.messages.map((m) => [m.uid, m.preview])).toEqual([
        [2, ''],
        [1, 'Shall we meet on Friday?']
      ])
    })
  })

  it('are not put over a screen the user has moved on to when the previews come in', async () => {
    const t = await appHarness()
    const work = await t.givenAccount('work', { INBOX: [{ uid: 1, source: 'Subject: One\r\n\r\nText' }], Trash: [] })
    const folder = t.folderOf(await listFolders(t.db, work.id), 'INBOX')
    await t.app.services.connections.ensure(work)
    await t.app.navigator.showMessages(work, folder, { sync: true })
    t.store.showScreen({ name: 'login' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(t.store.screen).toEqual({ name: 'login' })
  })

  it('say that there is no connection, and show what is stored, when asked to sync without one', async () => {
    const t = await inbox()
    await t.app.navigator.showMessages(t.work, t.folder, { sync: true })
    expect(t.store.screen).toMatchObject({ name: 'messages', busy: false, error: expect.stringContaining('Keine Verbindung') })
  })

  it('carry the names of the folders, for saying where a message is going', async () => {
    const t = await inbox()
    await t.app.navigator.showMessages(t.work, t.folder, { sync: false })
    const names = Object.values((t.store.screen as { folderNames: Record<string, string> }).folderNames)
    expect(names.sort()).toEqual(['INBOX', 'Trash'])
  })
})

describe('the status of the queue', () => {
  it('is read for the account that is open, after its queue was replayed', async () => {
    const t = await appHarness()
    const work = await t.givenAccount('work', { INBOX: [{ uid: 1 }], Trash: [] })
    t.server.unreachable.add('work')
    const folder = t.folderOf(await listFolders(t.db, work.id), 'INBOX')
    await t.app.services.mail.setFlags(folder, [1], ['\\Seen'], [])
    t.server.unreachable.delete('work')

    await t.app.navigator.openAccount(work)
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(t.store.state.waiting?.summary.total).toBe(0)
    expect((await listAccounts(t.db)).length).toBe(1)
  })
})

describe('searching', () => {
  it('shows what the search finds, from all accounts, with the words that were typed', async () => {
    const t = await twoAccounts()
    await t.app.navigator.showSearch('dinner')
    expect(t.store.screen).toMatchObject({ name: 'search', query: 'dinner', unsupported: [] })
    const screen = t.store.screen
    if (screen.name !== 'search') throw new Error('not the search')
    expect(screen.messages.map((message) => message.subject)).toEqual(['Dinner'])
  })

  it('shows an empty search with nothing found, and not everything', async () => {
    const t = await twoAccounts()
    await t.app.navigator.showSearch('')
    expect(t.store.screen).toEqual({ name: 'search', query: '', messages: [], unsupported: [] })
  })

  it('says what part of a search the phone cannot do', async () => {
    const t = await twoAccounts()
    await t.app.navigator.showSearch('an:alex dinner')
    expect(t.store.screen).toMatchObject({ name: 'search', unsupported: ['to'] })
  })

  it('shows the result of the last thing that was typed, whichever search is slower', async () => {
    const t = await twoAccounts()
    await t.app.navigator.showSearch('')
    await Promise.all([t.app.navigator.showSearch('budget', 'typing'), t.app.navigator.showSearch('dinner', 'typing')])
    expect(t.store.screen).toMatchObject({ name: 'search', query: 'dinner' })
  })

  it('does not take a screen back that the user has gone from while it was searching', async () => {
    const t = await twoAccounts()
    await t.app.navigator.showSearch('')
    const searching = t.app.navigator.showSearch('dinner', 'typing')
    await t.app.navigator.showAccounts()
    await searching
    expect(t.store.screen.name).toBe('accounts')
  })
})

describe('the lists of all accounts by role', () => {
  async function withSent() {
    const t = await appHarness()
    const work = await t.givenAccount('work', {
      INBOX: [{ uid: 1, subject: 'in work', date: day(1) }],
      Sent: [{ uid: 1, subject: 'sent from work', date: day(3) }],
      Trash: []
    })
    const home = await t.givenAccount('home', {
      INBOX: [{ uid: 1, subject: 'in home', date: day(2) }],
      Sent: [{ uid: 1, subject: 'sent from home', date: day(4) }],
      Trash: []
    })
    return { ...t, work, home }
  }

  it('shows the folders of the role that is asked for, from every account, and says which role it is', async () => {
    const t = await withSent()
    await t.app.navigator.showUnified({ refresh: false, role: 'sent' })
    const screen = t.store.screen
    if (screen.name !== 'unified') throw new Error('not the list')
    expect(screen.role).toBe('sent')
    expect(screen.messages.map((m) => m.subject)).toEqual(['sent from home', 'sent from work'])
  })

  it('is the inbox when no role has been asked for', async () => {
    const t = await withSent()
    await t.app.navigator.showUnified({ refresh: false })
    expect(t.store.screen).toMatchObject({ name: 'unified', role: 'inbox' })
  })

  it('is the role that was shown last when none is asked for, which is where leaving a message goes back to', async () => {
    const t = await withSent()
    await t.app.navigator.showUnified({ refresh: false, role: 'sent' })
    await t.app.navigator.showUnified({ refresh: false })
    expect(t.store.screen).toMatchObject({ name: 'unified', role: 'sent' })
  })

  it('brings the folders of that role up to date from the servers when it is asked to', async () => {
    const t = await withSent()
    t.server.mailboxes.get('work')?.Sent.push({ uid: 2, subject: 'newly sent', date: day(9) })
    await t.app.navigator.showUnified({ refresh: true, role: 'sent' })
    const screen = t.store.screen
    if (screen.name !== 'unified') throw new Error('not the list')
    expect(screen.messages.map((m) => m.subject)).toContain('newly sent')
  })
})

describe('opening a folder from the sidebar', () => {
  it('connects the account when it is not connected, and shows the folder as the server has it', async () => {
    const t = await twoAccounts()
    const [folder] = (await listFolders(t.db, t.work.id)).filter((f) => f.imapPath === 'INBOX')
    t.server.mailboxes.get('work')?.INBOX.push({ uid: 2, subject: 'new at work', date: day(5) })

    await t.app.navigator.openFolder(t.work, folder)

    const screen = t.store.screen
    if (screen.name !== 'messages') throw new Error('not the folder')
    expect(screen.messages.map((m) => m.subject)).toContain('new at work')
    expect(t.store.state.connected).toContain(t.work.id)
    expect(t.store.state.statusAccountId).toBe(t.work.id)
  })

  it('shows the folder as it was stored, and says why, when the server cannot be reached', async () => {
    const t = await twoAccounts()
    const [folder] = (await listFolders(t.db, t.work.id)).filter((f) => f.imapPath === 'INBOX')
    t.app.services.connections.drop(t.work.id)
    t.server.unreachable.add('work')

    await t.app.navigator.openFolder(t.work, folder)

    expect(t.store.screen).toMatchObject({
      name: 'messages',
      messages: [{ subject: 'Budget' }],
      error: 'Der Server ist nicht erreichbar. (work: connection refused)'
    })
  })

  it('replays what waited in the queue for the account before it shows the folder', async () => {
    const t = await twoAccounts()
    const [folder] = (await listFolders(t.db, t.work.id)).filter((f) => f.imapPath === 'INBOX')
    t.server.unreachable.add('work')
    await t.app.services.mail.setFlags(folder, [1], ['\\Seen'], [])
    t.server.unreachable.delete('work')
    t.server.calls.length = 0

    await t.app.navigator.openFolder(t.work, folder)

    expect(t.server.calls).toContain('add INBOX 1 \\Seen')
  })
})
