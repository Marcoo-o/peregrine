import { describe, expect, it } from 'vitest'
import { listFolders } from '../folders'
import { listMessages } from '../messages'
import { listPendingActions } from '@peregrine/core/pendingActionsStore'
import { appHarness } from '../testing/appHarness'
import type { FolderToolsState } from './screens'

/** An account with an inbox of three messages (one read), a trash with two, a folder of its own and one under it, all connected. */
async function withFolders() {
  const t = await appHarness()
  const work = await t.givenAccount('work', {
    INBOX: [{ uid: 1 }, { uid: 2, flags: ['\\Seen'] }, { uid: 3 }],
    Trash: [{ uid: 1 }, { uid: 2 }],
    Projects: [{ uid: 1 }],
    'Projects/Old': [{ uid: 1 }]
  })
  await t.app.services.connections.ensure(work)
  await t.app.navigator.showFolders(work, t.app.services.connections.get(work.id)!)
  const folders = await listFolders(t.db, work.id)
  const of = (path: string) => t.folderOf(folders, path)
  t.server.calls.length = 0
  const tools = async (path: string | null): Promise<FolderToolsState> => {
    if (path === null) await t.app.folders.startCreate(work)
    else await t.app.folders.startTools(work, t.folderOf(await listFolders(t.db, work.id), path))
    return t.store.screen as FolderToolsState
  }
  const pathsNow = async () => (await listFolders(t.db, work.id)).map((folder) => folder.imapPath).sort()
  return { ...t, work, of, tools, pathsNow }
}

describe('the screen for a folder', () => {
  it('is about the folder, with the folders of the account to choose from', async () => {
    const t = await withFolders()
    const state = await t.tools('Projects')
    expect(state).toMatchObject({ name: 'folderTools', folder: { imapPath: 'Projects' } })
    expect(state.folders.map((folder) => folder.imapPath)).toContain('Projects/Old')
  })

  it('goes back to the list of the folder, or for a new folder to the folders', async () => {
    const t = await withFolders()
    await t.app.folders.back(await t.tools('Projects'))
    expect(t.store.screen).toMatchObject({ name: 'messages', folder: { imapPath: 'Projects' } })
    await t.app.folders.back(await t.tools(null))
    expect(t.store.screen).toMatchObject({ name: 'folders' })
  })
})

describe('making a folder', () => {
  it('makes it on the server at the top or inside another, and shows the folders with it', async () => {
    const t = await withFolders()
    await t.app.folders.create(await t.tools(null), ' Receipts ', null)
    await t.app.folders.create(await t.tools(null), 'Plans', 'Projects')
    expect(t.server.calls).toEqual(['create Receipts', 'create Projects/Plans'])
    expect(t.store.screen).toMatchObject({ name: 'folders' })
    expect(await t.pathsNow()).toEqual(expect.arrayContaining(['Receipts', 'Projects/Plans']))
  })

  it('refuses a name that is no name, or one a folder next to it has, before it asks the server', async () => {
    const t = await withFolders()
    await t.app.folders.create(await t.tools(null), 'a/b', null)
    expect(t.store.screen).toMatchObject({ name: 'folderTools', error: expect.stringContaining('trennt') })
    await t.app.folders.create(await t.tools(null), 'projects', null)
    expect(t.store.screen).toMatchObject({ name: 'folderTools', error: expect.stringContaining('schon') })
    expect(t.server.calls).toEqual([])
  })

  it('says what the server said when it refuses, and stays on the screen', async () => {
    const t = await withFolders()
    t.server.refuseFolders = 'Permission denied'
    await t.app.folders.create(await t.tools(null), 'Receipts', null)
    expect(t.store.screen).toMatchObject({ name: 'folderTools', busy: false, error: expect.stringContaining('Permission denied') })
  })

  it('needs a connection, and says so', async () => {
    const t = await withFolders()
    const state = await t.tools(null)
    t.app.services.connections.dropAll()
    await t.app.folders.create(state, 'Receipts', null)
    expect(t.store.screen).toMatchObject({ name: 'folderTools', error: expect.stringContaining('Verbindung') })
    expect(t.server.calls.filter((call) => call.startsWith('create'))).toEqual([])
  })
})

describe('renaming a folder', () => {
  it('renames it on the server with what is under it, and keeps the id and what is stored of it', async () => {
    const t = await withFolders()
    const before = t.of('Projects')
    await t.app.folders.rename(await t.tools('Projects'), 'Plans')
    expect(t.server.calls).toContain('rename Projects > Plans')
    const after = await listFolders(t.db, t.work.id)
    expect(after.map((folder) => folder.imapPath).sort()).toEqual(expect.arrayContaining(['Plans', 'Plans/Old']))
    expect(after.find((folder) => folder.imapPath === 'Plans')?.id).toBe(before.id)
    expect(await listMessages(t.db, before.id)).toHaveLength(1)
    expect(t.store.screen).toMatchObject({ name: 'folders' })
  })

  it('keeps what waits in the queue for it, which still names the folder', async () => {
    const t = await withFolders()
    const folder = t.of('Projects')
    t.app.services.connections.dropAll()
    await t.app.services.mail.setFlags(folder, [1], ['\\Seen'], [])
    expect(await listPendingActions(t.db, t.work.id)).toHaveLength(1)
    await t.app.services.connections.ensure(t.work)
    await t.app.folders.rename(await t.tools('Projects'), 'Plans')
    const [waiting] = await listPendingActions(t.db, t.work.id)
    expect(JSON.stringify(waiting.payload)).toContain(folder.id)
  })

  it('does nothing for a folder that has a job, or for the same name, and refuses a name that is taken', async () => {
    const t = await withFolders()
    await t.app.folders.rename(await t.tools('Trash'), 'Bin')
    await t.app.folders.rename(await t.tools('Projects'), 'Projects')
    expect(t.server.calls).toEqual([])
    await t.app.folders.rename(await t.tools('Projects'), 'trash')
    expect(t.server.calls).toEqual([])
    expect(t.store.screen).toMatchObject({ name: 'folderTools', folder: { imapPath: 'Projects' }, error: expect.stringContaining('schon') })
  })

  it('may change only the case of its own name', async () => {
    const t = await withFolders()
    await t.app.folders.rename(await t.tools('Projects/Old'), 'old')
    expect(t.server.calls).toContain('rename Projects/Old > Projects/old')
  })

  it('stays on the screen with the reason when the server refuses', async () => {
    const t = await withFolders()
    t.server.refuseFolders = 'Not allowed'
    await t.app.folders.rename(await t.tools('Projects'), 'Plans')
    expect(t.store.screen).toMatchObject({ name: 'folderTools', error: expect.stringContaining('Not allowed') })
    expect(await t.pathsNow()).toContain('Projects')
  })
})

describe('deleting a folder', () => {
  it('deletes it on the server and takes it, with its messages, out of what is stored', async () => {
    const t = await withFolders()
    const folder = t.of('Projects/Old')
    await t.app.folders.remove(await t.tools('Projects/Old'))
    expect(t.server.calls).toContain('delete-folder Projects/Old')
    expect(await t.pathsNow()).not.toContain('Projects/Old')
    expect(await listMessages(t.db, folder.id)).toEqual([])
    expect(t.store.screen).toMatchObject({ name: 'folders' })
  })

  it('does not delete the inbox, or a folder with a job', async () => {
    const t = await withFolders()
    await t.app.folders.remove(await t.tools('INBOX'))
    await t.app.folders.remove(await t.tools('Trash'))
    expect(t.server.calls).toEqual([])
    expect(await t.pathsNow()).toEqual(expect.arrayContaining(['INBOX', 'Trash']))
  })
})

describe('marking a folder as read', () => {
  it('marks what is not read, on the list at once and on the server through the queue', async () => {
    const t = await withFolders()
    await t.app.folders.markAllRead(await t.tools('INBOX'))
    const flags = Object.fromEntries((await listMessages(t.db, t.of('INBOX').id)).map((message) => [message.uid, message.flags]))
    expect(flags[1]).toContain('\\Seen')
    expect(flags[3]).toContain('\\Seen')
    expect(t.server.calls).toEqual(expect.arrayContaining(['add INBOX 1 \\Seen', 'add INBOX 3 \\Seen']))
    expect(t.server.calls).not.toContain('add INBOX 2 \\Seen')
    expect(t.store.screen).toMatchObject({ name: 'folderTools', notice: '2 Nachrichten sind jetzt gelesen.' })
  })

  it('says so when there is nothing to mark, and works without a connection by waiting in the queue', async () => {
    const t = await withFolders()
    await t.app.folders.markAllRead(await t.tools('Projects/Old'))
    await t.app.folders.markAllRead(await t.tools('Projects/Old'))
    expect(t.store.screen).toMatchObject({ notice: 'Es gibt nichts Ungelesenes in diesem Ordner.' })

    t.app.services.connections.dropAll()
    await t.app.folders.markAllRead(await t.tools('Projects'))
    expect(t.store.screen).toMatchObject({ notice: expect.stringContaining('gelesen') })
    expect(await listPendingActions(t.db, t.work.id)).toHaveLength(1)
  })
})

describe('emptying the trash', () => {
  it('deletes every message of it for good, on the list at once and on the server through the queue', async () => {
    const t = await withFolders()
    await t.app.folders.empty(await t.tools('Trash'))
    expect(await listMessages(t.db, t.of('Trash').id)).toEqual([])
    expect(t.server.calls.filter((call) => call.startsWith('delete'))).not.toEqual([])
    expect(t.store.screen).toMatchObject({ name: 'folderTools', notice: '2 Nachrichten sind gelöscht.' })
  })

  it('says that an empty one is empty, and leaves every other folder alone', async () => {
    const t = await withFolders()
    await t.app.folders.empty(await t.tools('Trash'))
    await t.app.folders.empty(await t.tools('Trash'))
    expect(t.store.screen).toMatchObject({ notice: 'Der Ordner ist schon leer.' })
    await t.app.folders.empty(await t.tools('INBOX'))
    expect(await listMessages(t.db, t.of('INBOX').id)).toHaveLength(3)
  })
})
