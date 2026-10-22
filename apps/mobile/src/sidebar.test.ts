import { describe, expect, it } from 'vitest'
import type { FetchedMessage, MailboxEntry } from '@peregrine/core/imapSession'
import { addAccount, type NewAccount } from './accounts'
import { syncFolders } from './folders'
import { saveMessages } from './messages'
import { loadSidebar } from './sidebar'
import { migratedDatabase } from './testing/testDb'

const account = (name: string): NewAccount => ({
  displayName: name,
  emailAddress: `${name.toLowerCase()}@example.org`,
  imapHost: 'imap.example.org',
  imapPort: 993,
  imapSecure: 'tls',
  imapUsername: name,
  smtpHost: null,
  smtpPort: null,
  smtpSecure: null,
  smtpUsername: null,
  password: 'secret',
  smtpPassword: null
})

const entry = (path: string, specialUse: string | null = null): MailboxEntry => ({ path, name: path, parentPath: null, flags: [], specialUse })
const message = (uid: number, flags: string[] = []): FetchedMessage => ({
  uid,
  flags,
  size: 10,
  hasAttachment: false,
  envelope: { subject: `s${uid}`, date: new Date(1000 + uid), from: [{ address: 'a@example.net' }] }
})

describe('what the sidebar shows', () => {
  it('is nothing for no accounts', async () => {
    const { db } = await migratedDatabase()
    expect(await loadSidebar(db)).toEqual({
      unified: { inbox: 0, snoozed: 0, drafts: 0, sent: 0, archive: 0, junk: 0, trash: 0 },
      accounts: []
    })
  })

  it('has every account in the order they were added, with its folders and the unread messages of each of them', async () => {
    const { db } = await migratedDatabase()
    const work = await addAccount(db, account('Work'), { now: 1 })
    const home = await addAccount(db, account('Home'), { now: 2 })
    const [workInbox, workSent] = await syncFolders(db, work.id, [entry('INBOX'), entry('Sent', '\\Sent')])
    const [homeInbox] = await syncFolders(db, home.id, [entry('INBOX')])
    await saveMessages(db, workInbox, [message(1), message(2), message(3, ['\\Seen'])])
    await saveMessages(db, workSent, [message(1)])
    await saveMessages(db, homeInbox, [message(1)])

    const sidebar = await loadSidebar(db)

    expect(sidebar.accounts.map((entry) => entry.account.displayName)).toEqual(['Work', 'Home'])
    expect(sidebar.accounts[0].folders.map((folder) => folder.imapPath).sort()).toEqual(['INBOX', 'Sent'])
    expect(sidebar.accounts[0].unread).toEqual({ [workInbox.id]: 2, [workSent.id]: 1 })
    expect(sidebar.accounts[1].unread).toEqual({ [homeInbox.id]: 1 })
  })

  it('has the unread messages of each role over all accounts', async () => {
    const { db } = await migratedDatabase()
    const work = await addAccount(db, account('Work'), { now: 1 })
    const home = await addAccount(db, account('Home'), { now: 2 })
    const [workInbox] = await syncFolders(db, work.id, [entry('INBOX')])
    const [homeInbox] = await syncFolders(db, home.id, [entry('INBOX')])
    await saveMessages(db, workInbox, [message(1), message(2)])
    await saveMessages(db, homeInbox, [message(1)])
    expect((await loadSidebar(db)).unified).toEqual({ inbox: 3, snoozed: 0, drafts: 0, sent: 0, archive: 0, junk: 0, trash: 0 })
  })
})
