import { describe, expect, it } from 'vitest'
import type { FetchedMessage, MailboxEntry } from '@peregrine/core/imapSession'
import { addAccount, type NewAccount } from './accounts'
import { syncFolders } from './folders'
import { saveMessages } from './messages'
import { searchMessages } from './search'
import { migratedDatabase } from './testing/testDb'

const input = (over: Partial<NewAccount> = {}): NewAccount => ({
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
  smtpPassword: null,
  ...over
})

const entry = (path: string, specialUse: string | null = null): MailboxEntry => ({
  path,
  name: path,
  parentPath: null,
  flags: [],
  specialUse
})

const day = (n: number) => new Date(2026, 9, n, 12, 0)

const message = (
  uid: number,
  subject: string,
  from: { name?: string; address: string },
  over: { date?: Date; flags?: string[]; attachment?: boolean } = {}
): FetchedMessage => ({
  uid,
  flags: over.flags ?? [],
  size: 100,
  hasAttachment: over.attachment ?? false,
  envelope: { subject, date: over.date ?? day(1), from: [from] }
})

/** Two accounts with an inbox each and a sent folder for the first, with messages that tell the searches apart. */
async function mailboxes() {
  const { db } = await migratedDatabase()
  const work = await addAccount(db, input(), { now: 1 })
  const home = await addAccount(db, input({ displayName: 'Home', emailAddress: 'home@example.org', imapUsername: 'home' }), { now: 2 })
  const [workInbox, workSent] = await syncFolders(db, work.id, [entry('INBOX'), entry('Sent', '\\Sent')])
  const [homeInbox] = await syncFolders(db, home.id, [entry('INBOX')])
  await saveMessages(db, workInbox, [
    message(1, 'Budget for next quarter', { name: 'Anna Berger', address: 'anna@sender.test' }, { date: day(12) }),
    message(2, 'Meeting moved to Friday', { name: 'Ben', address: 'ben@sender.test' }, { date: day(14), flags: ['\\Seen'] }),
    message(3, 'Your invoice', { name: 'Billing', address: 'billing@shop.test' }, { date: day(18), attachment: true, flags: ['\\Flagged'] })
  ])
  await saveMessages(db, workSent, [message(1, 'Re: Budget for next quarter', { name: 'Work', address: 'work@example.org' }, { date: day(13) })])
  await saveMessages(db, homeInbox, [message(1, 'Dinner on Saturday?', { name: 'Dana', address: 'dana@sender.test' }, { date: day(10) })])
  return { db, work, home }
}

const subjects = async (db: Awaited<ReturnType<typeof mailboxes>>['db'], query: string) =>
  (await searchMessages(db, query)).messages.map((found) => found.subject)

describe('searching the messages that are on the phone', () => {
  it('finds a word in the subject or in who wrote, in any case, newest first, in every folder of every account', async () => {
    const { db } = await mailboxes()
    expect(await subjects(db, 'budget')).toEqual(['Re: Budget for next quarter', 'Budget for next quarter'])
  })

  it('wants every word, in the subject or in the sender, wherever each of them is', async () => {
    const { db } = await mailboxes()
    expect(await subjects(db, 'anna budget')).toEqual(['Budget for next quarter'])
    expect(await subjects(db, 'anna invoice')).toEqual([])
  })

  it('finds by who wrote, in the name or in the address', async () => {
    const { db } = await mailboxes()
    expect(await subjects(db, 'von:berger')).toEqual(['Budget for next quarter'])
    expect(await subjects(db, 'from:shop.test')).toEqual(['Your invoice'])
  })

  it('finds by the subject alone', async () => {
    const { db } = await mailboxes()
    expect(await subjects(db, 'betreff:friday')).toEqual(['Meeting moved to Friday'])
    expect(await subjects(db, 'subject:"next quarter"')).toEqual(['Re: Budget for next quarter', 'Budget for next quarter'])
  })

  it('finds what has an attachment, what is not read and what is starred', async () => {
    const { db } = await mailboxes()
    expect(await subjects(db, 'hat:anhang')).toEqual(['Your invoice'])
    expect(await subjects(db, 'has:attachment')).toEqual(['Your invoice'])
    expect(await subjects(db, 'ist:markiert')).toEqual(['Your invoice'])
    expect(await subjects(db, 'is:unread')).toEqual(['Your invoice', 'Re: Budget for next quarter', 'Budget for next quarter', 'Dinner on Saturday?'])
  })

  it('finds by date, from the first day on and up to the day before the last', async () => {
    const { db } = await mailboxes()
    expect(await subjects(db, 'nach:2026-10-14')).toEqual(['Your invoice', 'Meeting moved to Friday'])
    expect(await subjects(db, 'vor:14.10.2026')).toEqual(['Re: Budget for next quarter', 'Budget for next quarter', 'Dinner on Saturday?'])
  })

  it('takes % and _ in what is looked for as what they are', async () => {
    const { db } = await mailboxes()
    expect(await subjects(db, '%')).toEqual([])
    expect(await subjects(db, 'b_dget')).toEqual([])
  })

  it('puts the operators together with each other and with words', async () => {
    const { db } = await mailboxes()
    expect(await subjects(db, 'von:sender.test ist:ungelesen budget')).toEqual(['Budget for next quarter'])
  })

  it('says which part of the search it cannot do, and does the rest', async () => {
    const { db } = await mailboxes()
    const found = await searchMessages(db, 'an:alex budget')
    expect(found.unsupported).toEqual(['to'])
    expect(found.messages.map((m) => m.subject)).toContain('Budget for next quarter')
  })

  it('has nothing to look for in an empty search, and finds nothing', async () => {
    const { db } = await mailboxes()
    expect(await searchMessages(db, '')).toEqual({ messages: [], unsupported: [] })
    expect(await searchMessages(db, '   ')).toEqual({ messages: [], unsupported: [] })
  })

  it('has the account, its colour and the folder with each message it finds', async () => {
    const { db } = await mailboxes()
    const [found] = (await searchMessages(db, 'dinner')).messages
    expect(found).toMatchObject({ accountName: 'Home', uid: 1, folder: { imapPath: 'INBOX' } })
    expect(found.accountColor).toMatch(/^#/)
    const [sent] = (await searchMessages(db, 'Re:')).messages
    expect(sent.folder).toMatchObject({ imapPath: 'Sent', specialUse: '\\Sent' })
  })

  it('does not find more than it is asked for', async () => {
    const { db } = await mailboxes()
    expect((await searchMessages(db, 'sender.test', 2)).messages).toHaveLength(2)
  })
})

describe('searching the text of messages', () => {
  const withText = async () => {
    const { db } = await mailboxes()
    await db.run("UPDATE messages SET body_text = ? WHERE subject = 'Meeting moved to Friday'", 'The review is on Friday at 10, in the big room.')
    await db.run("UPDATE messages SET body_text = ? WHERE subject = 'Dinner on Saturday?'", 'Bring the quarterly numbers, and 100% of the wine.')
    return db
  }

  it('finds a word that is only in the text, in any case', async () => {
    const db = await withText()
    expect(await subjects(db, 'BIG room')).toEqual(['Meeting moved to Friday'])
  })

  it('wants every word, each in the subject, in who wrote or in the text', async () => {
    const db = await withText()
    // "friday" is in a subject, "room" is in that message's text: both are of the same message.
    expect(await subjects(db, 'friday room')).toEqual(['Meeting moved to Friday'])
    expect(await subjects(db, 'friday wine')).toEqual([])
  })

  it('still finds what has no text yet by its headers', async () => {
    const db = await withText()
    expect(await subjects(db, 'invoice')).toEqual(['Your invoice'])
  })

  it('takes a percent sign in the text for itself and not for any text', async () => {
    const db = await withText()
    expect(await subjects(db, '100%')).toEqual(['Dinner on Saturday?'])
    expect(await subjects(db, '%')).toEqual(['Dinner on Saturday?'])
  })

  it('does not look in the text for what is asked of the sender or of the subject', async () => {
    const db = await withText()
    expect(await subjects(db, 'betreff:wine')).toEqual([])
    expect(await subjects(db, 'von:wine')).toEqual([])
  })
})

describe('searching by tag', () => {
  async function tagged() {
    const { db, work } = await mailboxes()
    const { createTag } = await import('./tags')
    const bills = (await createTag(db, 'Rechnungen'))!
    const later = (await createTag(db, 'Für später'))!
    await db.run("UPDATE messages SET flags = ? WHERE account_id = ? AND subject = 'Your invoice'", JSON.stringify(['\Flagged', bills.keyword]), work.id)
    await db.run("UPDATE messages SET flags = ? WHERE account_id = ? AND subject LIKE 'Budget%'", JSON.stringify([bills.keyword, later.keyword]), work.id)
    return { db, bills, later }
  }

  it('finds the messages that have a tag, by the name the user gave it, in any case', async () => {
    const { db } = await tagged()
    expect(await subjects(db, 'tag:rechnungen')).toEqual(['Your invoice', 'Budget for next quarter'])
  })

  it('takes a name with spaces in quotes, which is a tag of its own and not a word', async () => {
    const { db } = await tagged()
    expect(await subjects(db, 'tag:"Für später"')).toEqual(['Budget for next quarter'])
  })

  it('narrows with every tag asked for, and with the rest of the syntax', async () => {
    const { db } = await tagged()
    expect(await subjects(db, 'tag:Rechnungen tag:"Für später"')).toEqual(['Budget for next quarter'])
    expect(await subjects(db, 'tag:Rechnungen hat:anhang')).toEqual(['Your invoice'])
    expect(await subjects(db, 'tag:Rechnungen invoice')).toEqual(['Your invoice'])
  })

  it('is a search of its own though there are no words, and finds nothing for a tag that nothing has', async () => {
    const { db } = await tagged()
    expect(await subjects(db, 'tag:Unbekannt')).toEqual([])
  })

  it('finds a keyword that another client set and the user made no tag of', async () => {
    const { db, work } = await mailboxes()
    await db.run("UPDATE messages SET flags = ? WHERE account_id = ? AND subject = 'Your invoice'", JSON.stringify(['Wichtig']), work.id)
    expect(await subjects(db, 'tag:wichtig')).toEqual(['Your invoice'])
  })

  it('looks for a tag: with nothing after it as a word', async () => {
    const { db } = await tagged()
    expect(await subjects(db, 'tag:')).toEqual([])
  })
})
