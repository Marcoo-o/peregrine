import { describe, expect, it } from 'vitest'
import type { FetchedMessage, MailboxEntry } from '@peregrine/core/imapSession'
import { addAccount } from './accounts'
import { suggestContacts, typedPart, withContact } from './contacts'
import { syncFolders } from './folders'
import { saveMessages } from './messages'
import { migratedDatabase } from './testing/testDb'

const entry = (path: string): MailboxEntry => ({ path, name: path, parentPath: null, flags: [], specialUse: null })

let uid = 0
const message = (from: { name?: string; address: string }, day = 1): FetchedMessage => ({
  uid: ++uid,
  flags: [],
  size: 100,
  hasAttachment: false,
  envelope: { subject: `Message ${uid}`, date: new Date(2026, 9, day, 12, 0), from: [from] }
})

async function mailbox(senders: Array<{ name?: string; address: string; day?: number; times?: number }>) {
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
  const [inbox] = await syncFolders(db, account.id, [entry('INBOX')])
  const all = senders.flatMap(({ times = 1, day, ...from }) => Array.from({ length: times }, () => message(from, day)))
  await saveMessages(db, inbox, all)
  return db
}

describe('the part of a field that is being typed', () => {
  it('is all of it when there is no separator, and what follows the last one when there is', () => {
    expect(typedPart('ann')).toEqual({ before: '', typed: 'ann' })
    expect(typedPart('anna@example.net, be')).toEqual({ before: 'anna@example.net,', typed: 'be' })
    expect(typedPart('a@example.net; b@example.net; ')).toEqual({ before: 'a@example.net; b@example.net;', typed: '' })
  })
})

describe('putting a contact into a field', () => {
  it('takes over the part that was typed and leaves a separator for the next address', () => {
    expect(withContact('ann', { name: 'Anna Berger', address: 'anna@sender.test' })).toBe('Anna Berger <anna@sender.test>, ')
    expect(withContact('ben@example.net, ann', { name: 'Anna', address: 'anna@sender.test' })).toBe(
      'ben@example.net, Anna <anna@sender.test>, '
    )
  })

  it('writes an address alone when there is no name, and a name with a comma in quotes', () => {
    expect(withContact('x', { name: '', address: 'anna@sender.test' })).toBe('anna@sender.test, ')
    expect(withContact('x', { name: 'Berger, Anna', address: 'anna@sender.test' })).toBe('"Berger, Anna" <anna@sender.test>, ')
  })
})

describe('the people to suggest', () => {
  it('are those whose name or address has what was typed in it, in any case', async () => {
    const db = await mailbox([
      { name: 'Anna Berger', address: 'anna@sender.test' },
      { name: 'Ben', address: 'ben@sender.test' },
      { name: 'Carla', address: 'carla@annex.test' }
    ])
    expect((await suggestContacts(db, 'ANN')).map((contact) => contact.address).sort()).toEqual(['anna@sender.test', 'carla@annex.test'])
    expect(await suggestContacts(db, 'zzz')).toEqual([])
  })

  it('come with the one that sent most first, and then the latest', async () => {
    const db = await mailbox([
      { name: 'Old', address: 'old@sender.test', day: 1 },
      { name: 'Often', address: 'often@sender.test', day: 2, times: 3 },
      { name: 'Latest', address: 'latest@sender.test', day: 20 }
    ])
    expect((await suggestContacts(db, 'sender')).map((contact) => contact.address)).toEqual([
      'often@sender.test',
      'latest@sender.test',
      'old@sender.test'
    ])
  })

  it('are one for each address, with the name and the spelling that were used most, and the messages of every spelling counted', async () => {
    const db = await mailbox([
      { name: 'Anna', address: 'Anna@Sender.test', times: 1 },
      { name: 'Anna Berger', address: 'anna@sender.test', times: 2 },
      { address: 'anna@sender.test', times: 1 }
    ])
    expect(await suggestContacts(db, 'anna')).toEqual([{ name: 'Anna Berger', address: 'anna@sender.test' }])
  })

  it('leave out the addresses of the user, and the address that has been typed in full', async () => {
    const db = await mailbox([
      { name: 'Alex', address: 'work@example.org' },
      { name: 'Anna', address: 'anna@sender.test' }
    ])
    expect(await suggestContacts(db, 'a', ['Work@Example.org'])).toEqual([{ name: 'Anna', address: 'anna@sender.test' }])
    expect(await suggestContacts(db, 'anna@sender.test')).toEqual([])
  })

  it('are no more than fit under a field', async () => {
    const db = await mailbox(Array.from({ length: 9 }, (_, i) => ({ name: `Person ${i}`, address: `p${i}@sender.test` })))
    expect(await suggestContacts(db, 'sender')).toHaveLength(4)
  })

  it('are none for nothing typed, and take nothing that is typed for a pattern', async () => {
    const db = await mailbox([{ name: 'Anna', address: 'anna@sender.test' }])
    expect(await suggestContacts(db, '  ')).toEqual([])
    expect(await suggestContacts(db, '%')).toEqual([])
    expect(await suggestContacts(db, '_nna')).toEqual([])
  })
})
