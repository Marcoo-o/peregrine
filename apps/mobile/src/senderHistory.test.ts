import { describe, expect, it } from 'vitest'
import type { FetchedMessage, MailboxEntry } from '@peregrine/core/imapSession'
import { addAccount } from './accounts'
import { syncFolders } from './folders'
import { saveMessages } from './messages'
import { isFirstContact, messagesFrom } from './senderHistory'
import { migratedDatabase } from './testing/testDb'

const entry = (path: string): MailboxEntry => ({ path, name: path, parentPath: null, flags: [], specialUse: null })

const message = (uid: number, from: { name?: string; address: string }): FetchedMessage => ({
  uid,
  flags: [],
  size: 100,
  hasAttachment: false,
  envelope: { subject: `Message ${uid}`, date: new Date(2026, 9, uid, 12, 0), from: [from] }
})

async function mailbox() {
  const { db } = await migratedDatabase()
  const account = await addAccount(
    db,
    {
      displayName: 'Work',
      emailAddress: 'work@example.org',
      imapHost: 'imap.example.org',
      imapPort: 993,
      imapSecure: 'tls',
      imapUsername: 'work',
      smtpHost: null,
      smtpPort: null,
      smtpSecure: null,
      smtpUsername: null,
      password: 'secret',
      smtpPassword: null
    },
    { now: 1 }
  )
  const [inbox, other] = await syncFolders(db, account.id, [entry('INBOX'), entry('Other')])
  await saveMessages(db, inbox, [
    message(1, { name: 'Anna Berger', address: 'Anna@Sender.test' }),
    message(2, { address: 'anna@sender.test' }),
    message(3, { name: 'Ben', address: 'ben@sender.test' })
  ])
  await saveMessages(db, other, [message(1, { name: 'Anna', address: 'anna@sender.test' })])
  return db
}

describe('how many messages the phone has from an address', () => {
  it('counts them in every folder, whether the sender has a name or not and in whatever case', async () => {
    expect(await messagesFrom(await mailbox(), 'anna@sender.test')).toBe(3)
    expect(await messagesFrom(await mailbox(), 'ANNA@sender.test')).toBe(3)
  })

  it('does not count another address that only contains this one', async () => {
    const db = await mailbox()
    expect(await messagesFrom(db, 'a@sender.test')).toBe(0)
    expect(await messagesFrom(db, 'sender.test')).toBe(0)
  })

  it('takes nothing in an address for a pattern', async () => {
    const db = await mailbox()
    expect(await messagesFrom(db, '%')).toBe(0)
    expect(await messagesFrom(db, '_nna@sender.test')).toBe(0)
  })

  it('is none for no address', async () => {
    expect(await messagesFrom(await mailbox(), '  ')).toBe(0)
  })
})

describe('a first message from an address', () => {
  it('is the only one there is, and the message that is open counts as one', () => {
    expect(isFirstContact(0)).toBe(true)
    expect(isFirstContact(1)).toBe(true)
    expect(isFirstContact(2)).toBe(false)
  })
})
