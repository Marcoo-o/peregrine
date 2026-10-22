import { describe, expect, it } from 'vitest'
import type { FetchedMessage, MailboxEntry } from '@peregrine/core/imapSession'
import { addAccount } from './accounts'
import { syncFolders } from './folders'
import { getMessage, listMessages, saveMessages, snoozeMessages, unreadCounts } from './messages'
import { migratedDatabase } from './testing/testDb'
import { listUnified, unifiedUnread } from './unified'

const entry = (path: string, specialUse: string | null = null): MailboxEntry => ({ path, name: path, parentPath: null, flags: [], specialUse })
const header = (uid: number, subject: string, day: number): FetchedMessage => ({
  uid,
  flags: [],
  size: 100,
  hasAttachment: false,
  envelope: { subject, date: new Date(2026, 9, day, 12, 0), from: [{ address: 'anna@sender.test' }] }
})

const NOW = Date.UTC(2026, 9, 22, 12, 0)
const LATER = NOW + 3_600_000
const EARLIER = NOW - 3_600_000

/** Two accounts with an inbox each, and three messages in the first: 1 and 2 and 3, from the oldest to the newest. */
async function mailboxes() {
  const { db } = await migratedDatabase()
  const input = (name: string) => ({
    displayName: name,
    emailAddress: `${name}@example.org`,
    imapHost: 'imap.example.org',
    imapPort: 993,
    imapSecure: 'tls' as const,
    imapUsername: name,
    smtpHost: null,
    smtpPort: null,
    smtpSecure: null,
    smtpUsername: null,
    password: 'secret',
    smtpPassword: null
  })
  const work = await addAccount(db, input('work'), { now: 1 })
  const home = await addAccount(db, input('home'), { now: 2 })
  const [workInbox] = await syncFolders(db, work.id, [entry('INBOX', '\\Inbox')])
  const [homeInbox] = await syncFolders(db, home.id, [entry('INBOX', '\\Inbox')])
  await saveMessages(db, workInbox, [header(1, 'one', 1), header(2, 'two', 2), header(3, 'three', 3)])
  await saveMessages(db, homeInbox, [header(1, 'dinner', 4)])
  return { db, workInbox, homeInbox }
}

const subjects = (messages: Array<{ subject: string }>) => messages.map((message) => message.subject)

describe('a message that is put aside', () => {
  it('is not in the list of its folder until its moment, and is when the moment has come', async () => {
    const { db, workInbox } = await mailboxes()
    await snoozeMessages(db, [{ folderId: workInbox.id, uid: 2 }], LATER)
    expect(subjects(await listMessages(db, workInbox.id, NOW))).toEqual(['three', 'one'])
    expect(subjects(await listMessages(db, workInbox.id, LATER))).toEqual(['three', 'two', 'one'])
    expect(subjects(await listMessages(db, workInbox.id, LATER + 1))).toEqual(['three', 'two', 'one'])
  })

  it('comes back when it is brought back with null, before its moment', async () => {
    const { db, workInbox } = await mailboxes()
    await snoozeMessages(db, [{ folderId: workInbox.id, uid: 2 }], LATER)
    await snoozeMessages(db, [{ folderId: workInbox.id, uid: 2 }], null)
    expect(subjects(await listMessages(db, workInbox.id, NOW))).toEqual(['three', 'two', 'one'])
  })

  it('is found by its UID all the same, and says when it comes back', async () => {
    const { db, workInbox } = await mailboxes()
    await snoozeMessages(db, [{ folderId: workInbox.id, uid: 2 }], LATER)
    expect(await getMessage(db, workInbox.id, 2)).toMatchObject({ subject: 'two', snoozedUntil: LATER })
    expect(await getMessage(db, workInbox.id, 1)).toMatchObject({ subject: 'one', snoozedUntil: null })
    expect(await getMessage(db, workInbox.id, 99)).toBeUndefined()
  })

  it('is not counted as unread in its folder while it is away', async () => {
    const { db, workInbox } = await mailboxes()
    await snoozeMessages(db, [{ folderId: workInbox.id, uid: 2 }], LATER)
    const account = (await db.get<{ id: string }>("SELECT id FROM accounts WHERE display_name = 'work'"))!.id
    expect(await unreadCounts(db, account, NOW)).toEqual({ [workInbox.id]: 2 })
    expect(await unreadCounts(db, account, LATER)).toEqual({ [workInbox.id]: 3 })
  })

  it('keeps its moment when the folder is fetched again', async () => {
    const { db, workInbox } = await mailboxes()
    await snoozeMessages(db, [{ folderId: workInbox.id, uid: 2 }], LATER)
    await saveMessages(db, workInbox, [header(2, 'two', 2)])
    expect(await getMessage(db, workInbox.id, 2)).toMatchObject({ snoozedUntil: LATER })
  })
})

describe('the lists of all accounts and what is put aside', () => {
  it('leave out the messages that are away from the list of the inboxes, and have them back at their moment', async () => {
    const { db, workInbox, homeInbox } = await mailboxes()
    await snoozeMessages(db, [{ folderId: workInbox.id, uid: 3 }, { folderId: homeInbox.id, uid: 1 }], LATER)
    expect(subjects(await listUnified(db, 200, 'inbox', NOW))).toEqual(['two', 'one'])
    expect(subjects(await listUnified(db, 200, 'inbox', LATER))).toEqual(['dinner', 'three', 'two', 'one'])
  })

  it('have a list of the messages that are away, of every account, the one that comes back first first', async () => {
    const { db, workInbox, homeInbox } = await mailboxes()
    await snoozeMessages(db, [{ folderId: workInbox.id, uid: 1 }], LATER + 2000)
    await snoozeMessages(db, [{ folderId: homeInbox.id, uid: 1 }], LATER)
    await snoozeMessages(db, [{ folderId: workInbox.id, uid: 2 }], EARLIER)
    const away = await listUnified(db, 200, 'snoozed', NOW)
    expect(subjects(away)).toEqual(['dinner', 'one'])
    expect(away.map((message) => message.snoozedUntil)).toEqual([LATER, LATER + 2000])
    expect(await listUnified(db, 200, 'snoozed', LATER + 5000)).toEqual([])
  })

  it('count what is away for that list, and do not count it as unread anywhere else', async () => {
    const { db, workInbox } = await mailboxes()
    expect(await unifiedUnread(db, NOW)).toMatchObject({ inbox: 4, snoozed: 0 })
    await snoozeMessages(db, [{ folderId: workInbox.id, uid: 1 }, { folderId: workInbox.id, uid: 2 }], LATER)
    expect(await unifiedUnread(db, NOW)).toMatchObject({ inbox: 2, snoozed: 2 })
    expect(await unifiedUnread(db, LATER)).toMatchObject({ inbox: 4, snoozed: 0 })
  })
})
