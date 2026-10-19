import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, openDb } from '../db'
import type { BetterSqliteDb } from '../sqlDb'
import { getAppSettings, updateAppSettings } from './appSettingsRepo'
import { importContacts, listContacts, upsertContactFromMail } from './contactsRepo'
import { getAccount, insertAccount, listAccounts } from './accountsRepo'
import { getFolderByPath, upsertFolder } from './foldersRepo'
import { createIdentity, deleteIdentity, listIdentities, setDefaultIdentity } from './identitiesRepo'
import {
  getMessageByUid,
  listMessagesPage,
  reconcileFlags,
  setMessageKeyword,
  setMessagesRead,
  setPendingMove,
  upsertEnvelope,
  type UpsertEnvelopeInput
} from './messagesRepo'
import {
  cancelPendingAction,
  dropQueuedMoves,
  enqueueAction,
  listPendingActions,
  pendingSummary
} from './pendingActionsRepo'
import { getAccountPgpKey, saveAccountPgpKey, setActiveAccountKey } from './pgpKeysRepo'
import { createTag, listTags } from './tagsRepo'
import { createTask, deferTask, getTask, listTasksForDay, setTaskDone } from './tasksRepo'

// The real implementation talks to the operating system's keychain through Electron.
vi.mock('../../credentials/secureStore', () => ({
  encryptSecret: (plain: string): Buffer => Buffer.from(plain, 'utf8'),
  decryptSecret: (encrypted: Buffer): string => encrypted.toString('utf8')
}))

let db: BetterSqliteDb

beforeEach(() => {
  // The whole schema, all migrations, in memory.
  db = openDb(':memory:', null)
})

afterEach(() => closeDb())

async function newAccount(name = 'a'): Promise<string> {
  return insertAccount(db, {
    displayName: name,
    emailAddress: `${name}@example.com`,
    imapHost: 'imap.example.com',
    imapPort: 993,
    imapSecure: 'tls',
    imapUsername: name,
    smtpHost: 'smtp.example.com',
    smtpPort: 465,
    smtpSecure: 'tls',
    smtpUsername: name
  })
}

async function newFolder(accountId: string, path = 'INBOX'): Promise<string> {
  return upsertFolder(db, {
    accountId,
    imapPath: path,
    displayName: path,
    specialUse: path === 'INBOX' ? 'inbox' : null,
    parentId: null,
    uidValidity: 1,
    uidNext: 1
  })
}

function envelope(
  accountId: string,
  folderId: string,
  uid: number,
  overrides: Partial<UpsertEnvelopeInput> = {}
): UpsertEnvelopeInput {
  return {
    accountId,
    folderId,
    uid,
    messageIdHeader: `<${uid}@example.com>`,
    inReplyTo: null,
    referencesHeader: null,
    subject: `Subject ${uid}`,
    fromName: 'Sender',
    fromAddress: 'sender@example.com',
    to: [],
    cc: [],
    bcc: [],
    date: new Date(2026, 0, uid).toISOString(),
    isRead: false,
    isFlagged: false,
    hasAttachments: false,
    previewText: '',
    sizeBytes: 100,
    flags: [],
    ...overrides
  }
}

// What the synchronous versions guaranteed by being synchronous. With an await between the
// read and the write, two calls at once can both read before either writes.
describe('read then write, started together', () => {
  it('two tags whose names fold to the same keyword get different keywords', async () => {
    await Promise.all([createTag(db, 'Für später', '#111111'), createTag(db, 'Fuer spaeter', '#222222')])

    const keywords = (await listTags(db)).map((tag) => tag.keyword)
    expect(new Set(keywords).size).toBe(2)
  })

  it('a sender seen twice at once is one contact with the count of both', async () => {
    await Promise.all([
      upsertContactFromMail(db, 'New Sender', 'new@example.com'),
      upsertContactFromMail(db, 'New Sender', 'new@example.com')
    ])

    const contacts = await listContacts(db, 'new@example.com')
    expect(contacts).toHaveLength(1)
    expect(contacts[0].frequency).toBe(2)
  })

  it('accounts added together do not share a position', async () => {
    await Promise.all([newAccount('one'), newAccount('two'), newAccount('three')])

    const orders = (await listAccounts(db)).map((account) => account.sortOrder)
    expect(new Set(orders).size).toBe(3)
  })

  // The sync reports a message as new once, and the notification follows from that. Two syncs
  // of one folder overlapping must not announce the same message twice.
  it('a message upserted twice at once is new only once', async () => {
    const account = await newAccount()
    const folder = await newFolder(account)

    const results = await Promise.all([
      upsertEnvelope(db, envelope(account, folder, 1)),
      upsertEnvelope(db, envelope(account, folder, 1))
    ])

    expect(results.filter((result) => result.isNew)).toHaveLength(1)
    expect(results[0].id).toBe(results[1].id)
  })

  it('two folder syncs of one path end with one folder', async () => {
    const account = await newAccount()
    const ids = await Promise.all([newFolder(account, 'Archive'), newFolder(account, 'Archive')])

    expect(ids[0]).toBe(ids[1])
  })

  it('deleting two identities at once never leaves an account without one', async () => {
    const account = await newAccount()
    const first = await createIdentity(db, {
      accountId: account,
      displayName: 'One',
      emailAddress: 'one@example.com',
      signature: ''
    })
    const second = await createIdentity(db, {
      accountId: account,
      displayName: 'Two',
      emailAddress: 'two@example.com',
      signature: ''
    })

    const removed = await Promise.all([deleteIdentity(db, first), deleteIdentity(db, second)])

    expect(removed.filter(Boolean)).toHaveLength(1)
    expect(await listIdentities(db, account)).toHaveLength(1)
  })

  it('setting two keywords on one message at once keeps both', async () => {
    const account = await newAccount()
    const folder = await newFolder(account)
    await upsertEnvelope(db, envelope(account, folder, 1))

    await Promise.all([
      setMessageKeyword(db, folder, 1, 'alpha', true),
      setMessageKeyword(db, folder, 1, 'beta', true)
    ])

    const stored = await getMessageByUid(db, folder, 1)
    expect(stored).toBeDefined()
    const page = await listMessagesPage(db, [folder], undefined, 10)
    expect(page.items[0].tagKeywords.sort()).toEqual(['alpha', 'beta'])
  })
})

describe('transactions in the repositories', () => {
  it('a failing batch of contacts is taken back as a whole', async () => {
    // The second entry has an address that breaks the unique index only if it were inserted
    // twice, so force the failure by closing over a bad value instead.
    await expect(
      importContacts(db, [
        { name: 'A', email: 'a@example.com' },
        { name: 'B', email: { toString: () => 'x' } as unknown as string }
      ])
    ).rejects.toThrow()

    expect(await listContacts(db)).toHaveLength(0)
  })

  it('importContacts reports what happened to each entry', async () => {
    await upsertContactFromMail(db, '', 'known@example.com')

    const counts = await importContacts(db, [
      { name: 'Known', email: 'known@example.com' },
      { name: 'Fresh', email: 'fresh@example.com' },
      { name: 'Broken', email: 'not-an-address' }
    ])

    expect(counts).toEqual({ added: 1, updated: 1, skipped: 1 })
  })
})

describe('messages', () => {
  it('pages through a list without losing or repeating a row', async () => {
    const account = await newAccount()
    const inbox = await newFolder(account, 'INBOX')
    const other = await newFolder(account, 'Other')
    for (let uid = 1; uid <= 5; uid++) await upsertEnvelope(db, envelope(account, inbox, uid))
    for (let uid = 1; uid <= 4; uid++) await upsertEnvelope(db, envelope(account, other, uid))

    const seen: string[] = []
    let cursor: string | undefined
    for (let guard = 0; guard < 10; guard++) {
      const page = await listMessagesPage(db, [inbox, other], cursor, 2)
      expect(page.totalCount).toBe(9)
      seen.push(...page.items.map((item) => item.id))
      if (!page.nextCursor) break
      cursor = page.nextCursor
    }

    expect(seen).toHaveLength(9)
    expect(new Set(seen).size).toBe(9)
  })

  it('reconcileFlags drops what the server no longer has and follows changed flags', async () => {
    const account = await newAccount()
    const folder = await newFolder(account)
    for (const uid of [1, 2, 3]) await upsertEnvelope(db, envelope(account, folder, uid))

    await reconcileFlags(db, folder, [
      { uid: 1, flags: ['\\Seen', '\\Flagged'] },
      { uid: 2, flags: [] }
    ])

    const page = await listMessagesPage(db, [folder], undefined, 10)
    const byUid = new Map(page.items.map((item) => [item.uid, item]))
    expect([...byUid.keys()].sort()).toEqual([1, 2])
    expect(byUid.get(1)).toMatchObject({ isRead: true, isFlagged: true })
    expect(byUid.get(2)).toMatchObject({ isRead: false, isFlagged: false })
  })

  it('marks a batch of messages read', async () => {
    const account = await newAccount()
    const folder = await newFolder(account)
    for (const uid of [1, 2, 3]) await upsertEnvelope(db, envelope(account, folder, uid))

    await setMessagesRead(db, folder, [1, 3], true)

    const page = await listMessagesPage(db, [folder], undefined, 10, { unreadOnly: true })
    expect(page.items.map((item) => item.uid)).toEqual([2])
  })
})

describe('the offline queue', () => {
  it('dropping a queued move takes the moved messages out of it', async () => {
    const account = await newAccount()
    const source = await newFolder(account, 'INBOX')
    const target = await newFolder(account, 'Archive')
    await enqueueAction(db, account, 'move', {
      sourceFolderId: source,
      targetFolderId: target,
      uids: [1, 2, 3]
    })

    await dropQueuedMoves(db, account, source, [2])

    const [action] = await listPendingActions(db, account)
    expect(action.payload).toMatchObject({ uids: [1, 3] })
  })

  it('cancelling a move also clears the mark on its messages', async () => {
    const account = await newAccount()
    const source = await newFolder(account, 'INBOX')
    const target = await newFolder(account, 'Archive')
    await upsertEnvelope(db, envelope(account, source, 1))
    await setPendingMove(db, source, [1], target)
    const id = await enqueueAction(db, account, 'move', {
      sourceFolderId: source,
      targetFolderId: target,
      uids: [1]
    })

    await cancelPendingAction(db, id)

    const page = await listMessagesPage(db, [source], undefined, 10)
    expect(page.items[0].pendingMoveTo).toBeNull()
    expect((await pendingSummary(db)).total).toBe(0)
  })
})

describe('tasks', () => {
  it('a task is written together with its checklist', async () => {
    const id = await createTask(db, { title: 'Pack', items: ['Tent', '', 'Stove'] }, '2026-08-01')

    const task = await getTask(db, id)
    expect(task?.items.map((item) => item.title)).toEqual(['Tent', 'Stove'])
  })

  it('moving a one-off task on clears its completion', async () => {
    const id = await createTask(db, { title: 'Once' }, '2026-08-01')
    await setTaskDone(db, id, '2026-08-01', true)

    expect(await deferTask(db, id, '2026-08-02')).toBe(true)

    const tasks = await listTasksForDay(db, '2026-08-02')
    expect(tasks.find((task) => task.id === id)?.done).toBe(false)
  })

  it('does not move a repeating task', async () => {
    const id = await createTask(db, { title: 'Daily', recurrence: 'daily' }, '2026-08-01')

    expect(await deferTask(db, id, '2026-08-02')).toBe(false)
  })
})

describe('settings, folders and keys', () => {
  it('settings round trip with their types', async () => {
    const saved = await updateAppSettings(db, { theme: 'dark', sidebarWidth: 300, threadView: true })

    expect(saved).toMatchObject({ theme: 'dark', sidebarWidth: 300, threadView: true })
    expect(await getAppSettings(db)).toMatchObject({ theme: 'dark', sidebarWidth: 300, threadView: true })
  })

  // It decides which client talks to the mail servers, so it must not be on for anybody who did
  // not turn it on.
  it('keeps the built-in IMAP client off until it is switched on', async () => {
    expect((await getAppSettings(db)).experimentalImapClient).toBe(false)

    await updateAppSettings(db, { experimentalImapClient: true })

    expect((await getAppSettings(db)).experimentalImapClient).toBe(true)
  })

  it('finds a folder by its path and an account by its id', async () => {
    const account = await newAccount()
    const folder = await newFolder(account, 'Projects')

    expect((await getFolderByPath(db, account, 'Projects'))?.id).toBe(folder)
    expect((await getAccount(db, account))?.emailAddress).toBe('a@example.com')
  })

  it('only one key per account is active, and the choice can change', async () => {
    const account = await newAccount()
    await saveAccountPgpKey(db, account, 'public-1', 'private-1', 'AAAA')
    await saveAccountPgpKey(db, account, 'public-2', 'private-2', 'BBBB')

    expect((await getAccountPgpKey(db, account))?.fingerprint).toBe('BBBB')
    await setActiveAccountKey(db, account, 'AAAA')
    expect((await getAccountPgpKey(db, account))?.privateKeyArmored).toBe('private-1')
  })

  it('a default identity can be chosen', async () => {
    const account = await newAccount()
    const first = await createIdentity(db, {
      accountId: account,
      displayName: 'One',
      emailAddress: 'one@example.com',
      signature: ''
    })
    await setDefaultIdentity(db, first)

    expect((await listIdentities(db, account))[0]).toMatchObject({ id: first, isDefault: true })
  })
})
