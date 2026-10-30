import { describe, expect, it } from 'vitest'
import { folderNameProblem, folderUids, isChangeable, isEmptiable, namesIn, pathWithName, renameFolderRows, renamedPath } from './folderOps'
import { addAccount } from './accounts'
import { listFolders, syncFolders, type Folder } from './folders'
import { saveMessages } from './messages'
import { migratedDatabase } from './testing/testDb'
import { account } from './testing/appHarness'

const folder = (over: Partial<Folder> = {}): Folder => ({
  id: 'f1',
  accountId: 'a1',
  imapPath: 'Projects',
  displayName: 'Projects',
  specialUse: null,
  parentPath: null,
  ...over
})

describe('which folders can be changed', () => {
  it('are those without a job, and never the inbox', () => {
    expect(isChangeable(folder())).toBe(true)
    expect(isChangeable(folder({ specialUse: '\\Sent', imapPath: 'Sent', displayName: 'Sent' }))).toBe(false)
    expect(isChangeable(folder({ imapPath: 'INBOX', displayName: 'INBOX' }))).toBe(false)
  })

  it('can be emptied when they are the trash or the junk folder, and no other', () => {
    expect(isEmptiable(folder({ specialUse: '\\Trash' }))).toBe(true)
    expect(isEmptiable(folder({ specialUse: '\\Junk' }))).toBe(true)
    expect(isEmptiable(folder({ specialUse: '\\Sent' }))).toBe(false)
    expect(isEmptiable(folder())).toBe(false)
  })
})

describe('the name of a folder', () => {
  it('is taken when it is a name', () => {
    expect(folderNameProblem('Receipts', '/', ['Projects'])).toBeNull()
    expect(folderNameProblem('  Receipts  ', '/', [])).toBeNull()
  })

  it('is refused when it is empty, too long, or only dots', () => {
    expect(folderNameProblem('   ', '/', [])).toMatch(/Namen/)
    expect(folderNameProblem('x'.repeat(101), '/', [])).toMatch(/höchstens 100/)
    expect(folderNameProblem('..', '/', [])).toMatch(/nicht erlaubt/)
  })

  it('is refused when it holds the delimiter, a wildcard or a control character', () => {
    expect(folderNameProblem('a/b', '/', [])).toMatch(/„\/“/)
    expect(folderNameProblem('a.b', '.', [])).toMatch(/„\.“/)
    expect(folderNameProblem('a*', '/', [])).toMatch(/Zeichen/)
    expect(folderNameProblem('a%', '/', [])).toMatch(/Zeichen/)
    expect(folderNameProblem('a\u0007b', '/', [])).toMatch(/Zeichen/)
  })

  it('is refused when a folder next to it has it, whatever the case, and not for the folder itself', () => {
    expect(folderNameProblem('projects', '/', ['Projects'])).toMatch(/schon/)
    expect(folderNameProblem('Projects', '/', ['Projects'], 'Projects')).toBeNull()
  })
})

describe('the paths of folders', () => {
  it('are made of the place and the name, with the delimiter the server uses', () => {
    expect(pathWithName(null, ' Receipts ', '/')).toBe('Receipts')
    expect(pathWithName('Work', 'Receipts', '.')).toBe('Work.Receipts')
  })

  it('change in the last segment only when a folder is renamed', () => {
    expect(renamedPath('Projects', 'Work', '/')).toBe('Work')
    expect(renamedPath('Work/Projects', 'Old', '/')).toBe('Work/Old')
  })

  it('are the names of those next to each other', () => {
    const folders = [folder(), folder({ id: 'f2', imapPath: 'Work/Old', displayName: 'Old', parentPath: 'Work' })]
    expect(namesIn(folders, null)).toEqual(['Projects'])
    expect(namesIn(folders, 'Work')).toEqual(['Old'])
  })
})

describe('renaming a folder that is stored', () => {
  async function stored() {
    const { db } = await migratedDatabase()
    const owner = await addAccount(db, account('work'))
    const entry = (path: string, parentPath: string | null) => ({
      path,
      name: path.slice(path.lastIndexOf('/') + 1),
      parentPath,
      flags: [],
      specialUse: null
    })
    await syncFolders(db, owner.id, [entry('Work', null), entry('Work/Projects', 'Work'), entry('Work/Projects/2026', 'Work/Projects'), entry('Other', null)])
    return { db, owner }
  }

  it('keeps the ids of the folder and of those under it, and moves their paths and names', async () => {
    const { db, owner } = await stored()
    const before = new Map((await listFolders(db, owner.id)).map((f) => [f.imapPath, f.id]))
    await renameFolderRows(db, owner.id, 'Work/Projects', 'Work/Plans', '/')
    const after = await listFolders(db, owner.id)
    const byPath = new Map(after.map((f) => [f.imapPath, f]))
    expect([...byPath.keys()].sort()).toEqual(['Other', 'Work', 'Work/Plans', 'Work/Plans/2026'])
    expect(byPath.get('Work/Plans')).toMatchObject({ id: before.get('Work/Projects'), displayName: 'Plans', parentPath: 'Work' })
    expect(byPath.get('Work/Plans/2026')).toMatchObject({ id: before.get('Work/Projects/2026'), displayName: '2026', parentPath: 'Work/Plans' })
    expect(byPath.get('Other')?.id).toBe(before.get('Other'))
  })

  it('does not touch a folder whose path only begins the same way', async () => {
    const { db, owner } = await stored()
    const entry = (path: string) => ({ path, name: path, parentPath: null, flags: [], specialUse: null })
    await syncFolders(db, owner.id, [...(await listFolders(db, owner.id)).map((f) => ({ path: f.imapPath, name: f.displayName, parentPath: f.parentPath, flags: [], specialUse: null })), entry('Work/ProjectsOld')])
    await renameFolderRows(db, owner.id, 'Work/Projects', 'Work/Plans', '/')
    expect((await listFolders(db, owner.id)).map((f) => f.imapPath)).toContain('Work/ProjectsOld')
  })
})

describe('the messages of a folder that a decision is made on', () => {
  it('are all of them, or those not read whatever the case of the flag', async () => {
    const { db } = await migratedDatabase()
    const owner = await addAccount(db, account('work'))
    const [inbox] = await syncFolders(db, owner.id, [{ path: 'INBOX', name: 'INBOX', parentPath: null, flags: [], specialUse: null }])
    const message = (uid: number, flags: string[]) => ({
      uid,
      flags,
      size: 1,
      date: new Date(0),
      envelope: { subject: `m${uid}`, from: [{ address: 'x@example.net' }] },
      hasAttachment: false
    })
    await saveMessages(db, inbox, [message(1, ['\\Seen']), message(2, []), message(3, ['\\seen']), message(4, ['\\Flagged'])] as never)
    expect(await folderUids(db, inbox.id)).toEqual([1, 2, 3, 4])
    expect(await folderUids(db, inbox.id, { unreadOnly: true })).toEqual([2, 4])
  })
})
