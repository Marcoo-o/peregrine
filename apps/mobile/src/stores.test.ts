import { describe, expect, it } from 'vitest'
import type { FetchedMessage, MailboxEntry } from '@peregrine/core/imapSession'
import { enqueueAction } from '@peregrine/core/pendingActionsStore'
import { addAccount, getAccount, listAccounts, removeAccount, type NewAccount } from './accounts'
import { getFolder, listFolders, syncFolders } from './folders'
import { deleteMessages, listMessages, saveMessages, setPendingMove } from './messages'
import { migratedDatabase } from './testing/testDb'

const input = (over: Partial<NewAccount> = {}): NewAccount => ({
  displayName: 'Alex',
  emailAddress: 'alex@example.org',
  imapHost: 'imap.example.org',
  imapPort: 993,
  imapSecure: 'tls',
  imapUsername: 'alex@example.org',
  smtpHost: null,
  smtpPort: null,
  smtpSecure: null,
  smtpUsername: null,
  password: 'secret',
  smtpPassword: null,
  ...over
})

const entry = (path: string, over: Partial<MailboxEntry> = {}): MailboxEntry => ({
  path,
  name: path.split('/').pop() as string,
  parentPath: null,
  flags: [],
  specialUse: null,
  ...over
})

const fetched = (uid: number, over: { subject?: string; flags?: string[]; from?: { name?: string; address?: string }[] } = {}): FetchedMessage => ({
  uid,
  flags: over.flags ?? [],
  size: 100 + uid,
  hasAttachment: uid % 2 === 0,
  envelope: { subject: over.subject ?? `Subject ${uid}`, date: new Date(1_000_000 + uid), from: over.from ?? [{ name: 'Anna', address: 'anna@example.net' }] }
})

let counter = 0
const ids = () => `id${++counter}`

describe('accounts', () => {
  it('keeps several side by side, in the order they were added, each with its own id', async () => {
    const { db } = await migratedDatabase()
    const first = await addAccount(db, input({ displayName: 'Work' }), { now: 1000 })
    const second = await addAccount(db, input({ displayName: 'Home', imapUsername: 'home' }), { now: 2000 })
    expect(first.id).not.toBe(second.id)
    expect((await listAccounts(db)).map((a) => a.displayName)).toEqual(['Work', 'Home'])
    expect(await getAccount(db, second.id)).toEqual(second)
    expect(await getAccount(db, 'nobody')).toBeUndefined()
  })

  it('keeps every setting, the ones for sending too, and the login', async () => {
    const { db } = await migratedDatabase()
    const sending = input({ smtpHost: 'smtp.example.org', smtpPort: 587, smtpSecure: 'starttls', smtpUsername: 'alex', smtpPassword: 'other' })
    const account = await addAccount(db, sending)
    expect(await getAccount(db, account.id)).toMatchObject(sending)
  })

  it('removes an account with its folders, messages and queued actions, and nobody else’s', async () => {
    const { db, raw } = await migratedDatabase()
    const a = await addAccount(db, input({ displayName: 'A' }))
    const b = await addAccount(db, input({ displayName: 'B' }))
    for (const account of [a, b]) {
      const [folder] = await syncFolders(db, account.id, [entry('INBOX')], ids)
      await saveMessages(db, folder, [fetched(1)])
      await enqueueAction(db, account.id, 'delete', { folderId: folder.id, uids: [1] })
    }

    await removeAccount(db, a.id)

    expect((await listAccounts(db)).map((x) => x.displayName)).toEqual(['B'])
    const count = (table: string, column = 'account_id') => (raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`).get(a.id) as { n: number }).n
    expect([count('folders'), count('messages'), count('pending_actions')]).toEqual([0, 0, 0])
    const other = (table: string) => (raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE account_id = ?`).get(b.id) as { n: number }).n
    expect([other('folders'), other('messages'), other('pending_actions')]).toEqual([1, 1, 1])
  })

  it('removes nothing when the account does not exist', async () => {
    const { db } = await migratedDatabase()
    const a = await addAccount(db, input())
    await removeAccount(db, 'nobody')
    expect(await listAccounts(db)).toHaveLength(1)
    expect(a.id).toBeTruthy()
  })
})

describe('folders', () => {
  it('stores the folders the server lists, each with an id, the inbox first, then those with a role', async () => {
    const { db } = await migratedDatabase()
    const account = await addAccount(db, input())
    const folders = await syncFolders(
      db,
      account.id,
      [entry('Zeta'), entry('Sent', { specialUse: '\\Sent' }), entry('INBOX', { specialUse: '\\Inbox' }), entry('alpha')],
      ids
    )
    expect(folders.map((f) => f.imapPath)).toEqual(['INBOX', 'Sent', 'alpha', 'Zeta'])
    expect(new Set(folders.map((f) => f.id)).size).toBe(4)
  })

  it('keeps the id of a folder that is listed again, which is what the queue and its messages name it by', async () => {
    const { db } = await migratedDatabase()
    const account = await addAccount(db, input())
    const [before] = await syncFolders(db, account.id, [entry('INBOX')], ids)
    const [after] = await syncFolders(db, account.id, [entry('INBOX', { name: 'Posteingang', specialUse: '\\Inbox' })], ids)
    expect(after.id).toBe(before.id)
    expect(after.displayName).toBe('Posteingang')
    expect(after.specialUse).toBe('\\Inbox')
  })

  it('drops a folder the server no longer lists, with its messages', async () => {
    const { db, raw } = await migratedDatabase()
    const account = await addAccount(db, input())
    const [inbox, old] = await syncFolders(db, account.id, [entry('INBOX'), entry('Old')], ids)
    await saveMessages(db, old, [fetched(1)])
    await saveMessages(db, inbox, [fetched(2)])

    const left = await syncFolders(db, account.id, [entry('INBOX')], ids)

    expect(left.map((f) => f.imapPath)).toEqual(['INBOX'])
    expect((raw.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number }).n).toBe(1)
  })

  it('does not keep a folder that cannot be selected', async () => {
    const { db } = await migratedDatabase()
    const account = await addAccount(db, input())
    const folders = await syncFolders(db, account.id, [entry('Parent', { flags: ['\\Noselect', '\\HasChildren'] }), entry('Parent/Child')], ids)
    expect(folders.map((f) => f.imapPath)).toEqual(['Parent/Child'])
  })

  it('keeps the folders of two accounts apart, even where they have the same path', async () => {
    const { db } = await migratedDatabase()
    const a = await addAccount(db, input())
    const b = await addAccount(db, input({ displayName: 'B' }))
    await syncFolders(db, a.id, [entry('INBOX'), entry('A-only')], ids)
    await syncFolders(db, b.id, [entry('INBOX')], ids)
    expect((await listFolders(db, a.id)).map((f) => f.imapPath).sort()).toEqual(['A-only', 'INBOX'])
    expect((await listFolders(db, b.id)).map((f) => f.imapPath)).toEqual(['INBOX'])
    // syncing B did not touch A's
    await syncFolders(db, b.id, [], ids)
    expect(await listFolders(db, a.id)).toHaveLength(2)
  })

  it('finds a folder by its id', async () => {
    const { db } = await migratedDatabase()
    const account = await addAccount(db, input())
    const [folder] = await syncFolders(db, account.id, [entry('INBOX')], ids)
    expect(await getFolder(db, folder.id)).toEqual(folder)
    expect(await getFolder(db, 'nothing')).toBeUndefined()
  })
})

describe('messages', () => {
  async function inbox() {
    const made = await migratedDatabase()
    const account = await addAccount(made.db, input())
    const [folder] = await syncFolders(made.db, account.id, [entry('INBOX')], ids)
    return { ...made, account, folder }
  }

  it('stores what a sync fetched and lists the newest first', async () => {
    const { db, folder } = await inbox()
    await saveMessages(db, folder, [fetched(1, { flags: ['\\Seen'] }), fetched(2), fetched(3)])
    const list = await listMessages(db, folder.id)
    expect(list.map((m) => m.uid)).toEqual([3, 2, 1])
    expect(list[2]).toMatchObject({ subject: 'Subject 1', sender: 'Anna <anna@example.net>', flags: ['\\Seen'], size: 101, hasAttachment: false, pendingMoveTo: null })
    expect(list[1].hasAttachment).toBe(true)
  })

  it('writes a sender with no name as the address, and one with no address as nothing', async () => {
    const { db, folder } = await inbox()
    await saveMessages(db, folder, [fetched(1, { from: [{ address: 'only@example.net' }] }), fetched(2, { from: [] })])
    const list = await listMessages(db, folder.id)
    expect(list.map((m) => m.sender)).toEqual(['', 'only@example.net'])
  })

  it('updates a message that is already there, flags included', async () => {
    const { db, folder } = await inbox()
    await saveMessages(db, folder, [fetched(1)])
    await saveMessages(db, folder, [fetched(1, { subject: 'Changed', flags: ['\\Seen', '\\Flagged'] })])
    const list = await listMessages(db, folder.id)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ subject: 'Changed', flags: ['\\Seen', '\\Flagged'] })
  })

  // Replacing the row would clear the mark, and the message would show in the folder it is leaving
  // until the queue next ran.
  it('keeps the mark of a queued move when a sync brings the message again', async () => {
    const { db, folder } = await inbox()
    await saveMessages(db, folder, [fetched(1)])
    await setPendingMove(db, folder.id, [1], 'archive-folder-id')
    await saveMessages(db, folder, [fetched(1, { subject: 'Seen again' })])
    const [message] = await listMessages(db, folder.id)
    expect(message.subject).toBe('Seen again')
    expect(message.pendingMoveTo).toBe('archive-folder-id')
  })

  it('marks messages for a move, and takes the mark off with null', async () => {
    const { db, folder } = await inbox()
    await saveMessages(db, folder, [fetched(1), fetched(2), fetched(3)])
    await setPendingMove(db, folder.id, [1, 3], 'target')
    expect((await listMessages(db, folder.id)).map((m) => m.pendingMoveTo)).toEqual(['target', null, 'target'])
    await setPendingMove(db, folder.id, [1, 3], null)
    expect((await listMessages(db, folder.id)).every((m) => m.pendingMoveTo === null)).toBe(true)
  })

  it('deletes messages of one folder and leaves the others', async () => {
    const { db, account, folder } = await inbox()
    const [, other] = await syncFolders(db, account.id, [entry('INBOX'), entry('Other')], ids)
    await saveMessages(db, folder, [fetched(1), fetched(2)])
    await saveMessages(db, other, [fetched(1), fetched(2)])
    await deleteMessages(db, folder.id, [1])
    expect((await listMessages(db, folder.id)).map((m) => m.uid)).toEqual([2])
    expect((await listMessages(db, other.id)).map((m) => m.uid)).toEqual([2, 1])
  })

  it('handles more messages at once than fit in one statement, and none at all', async () => {
    const { db, folder } = await inbox()
    const uids = Array.from({ length: 1300 }, (_, i) => i + 1)
    await saveMessages(db, folder, uids.map((uid) => fetched(uid)))
    await setPendingMove(db, folder.id, uids, 'target')
    expect((await listMessages(db, folder.id)).every((m) => m.pendingMoveTo === 'target')).toBe(true)
    await deleteMessages(db, folder.id, uids.slice(0, 1200))
    expect(await listMessages(db, folder.id)).toHaveLength(100)
    await expect(deleteMessages(db, folder.id, [])).resolves.toBeUndefined()
    await expect(setPendingMove(db, folder.id, [], null)).resolves.toBeUndefined()
  })
})
