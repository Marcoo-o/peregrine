import { describe, expect, it } from 'vitest'
import type { FetchedMessage, ImapSession, MailboxEntry } from '@peregrine/core/imapSession'
import { addAccount } from './accounts'
import { BodyIndexer, indexBodies, INDEX_BATCH, MAX_BODY_CHARS, PREVIEW_CHARS, previewOf, searchableOf, storeBody } from './bodyIndex'
import { syncFolders } from './folders'
import { listMessages, saveMessages } from './messages'
import { migratedDatabase } from './testing/testDb'

const crlf = (lines: string[]): string => lines.join('\r\n')
const bytes = (text: string): Uint8Array => Uint8Array.from(text, (c) => c.charCodeAt(0))
const mail = (text: string): Uint8Array =>
  bytes(crlf(['From: Anna <anna@sender.test>', 'Subject: Hi', 'Content-Type: text/plain', '', text, '']))

describe('the line that a list shows under a subject', () => {
  it('is the text flattened to one line', () => {
    expect(previewOf('Hello,\r\n\r\n   Shall we\nmeet?  ')).toBe('Hello, Shall we meet?')
  })

  it('leaves out what is quoted from an earlier message, which is not what this one says', () => {
    expect(previewOf('Yes, Friday.\n\n> Can we meet?\n>> Earlier still\nAnna')).toBe('Yes, Friday. Anna')
  })

  it('is cut where a line would stop being useful, and says so', () => {
    const long = previewOf('word '.repeat(100))
    expect(long.length).toBeLessThanOrEqual(PREVIEW_CHARS)
    expect(long.endsWith('…')).toBe(true)
  })

  it('is empty for a text that has nothing of its own', () => {
    expect(previewOf('')).toBe('')
    expect(previewOf('> only a quote')).toBe('')
  })
})

describe('the text that is kept for the search', () => {
  it('has one kind of line end and no more than it is worth', () => {
    expect(searchableOf('one\r\ntwo\r\n')).toBe('one\ntwo')
    expect(searchableOf('x'.repeat(MAX_BODY_CHARS + 500))).toHaveLength(MAX_BODY_CHARS)
  })
})

const entry = (path: string): MailboxEntry => ({ path, name: path, parentPath: null, flags: [], specialUse: null })
const header = (uid: number): FetchedMessage => ({
  uid,
  flags: [],
  size: 100,
  hasAttachment: false,
  envelope: { subject: `Message ${uid}`, date: new Date(2026, 9, 1, 12, 0), from: [{ address: 'anna@sender.test' }] }
})

async function folderWith(uids: number[]) {
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
  const [folder] = await syncFolders(db, account.id, [entry('INBOX')])
  await saveMessages(db, folder, uids.map(header))
  return { db, folder }
}

/** A connection that has these messages, by UID, and writes down which it was asked for. */
function session(sources: Record<number, Uint8Array | 'gone' | Error>) {
  const asked: number[] = []
  const imap = {
    fetchFullMessage: async (_path: string, uid: number) => {
      asked.push(uid)
      const found = sources[uid]
      if (found instanceof Error) throw found
      if (found === undefined || found === 'gone') return undefined
      return { source: found }
    }
  } as unknown as ImapSession
  return { imap, asked }
}

const quiet = { error: () => undefined }
const previews = async (db: Awaited<ReturnType<typeof folderWith>>['db'], folderId: string) =>
  Object.fromEntries((await listMessages(db, folderId)).map((message) => [message.uid, message.preview]))

describe('keeping the text of a message', () => {
  it('keeps the text for the search and the line for the list', async () => {
    const { db, folder } = await folderWith([1])
    await storeBody(db, folder.id, 1, 'Shall we meet on Friday?')
    expect(await previews(db, folder.id)).toEqual({ 1: 'Shall we meet on Friday?' })
    expect(await db.get('SELECT body_text FROM messages')).toEqual({ body_text: 'Shall we meet on Friday?' })
  })
})

describe('fetching the texts of a folder', () => {
  it('fetches the newest messages that have no text, a few at a time, and keeps them', async () => {
    const { db, folder } = await folderWith([1, 2, 3, 4])
    const { imap, asked } = session({ 1: mail('one'), 2: mail('two'), 3: mail('three'), 4: mail('four') })
    expect(await indexBodies(imap, db, folder, quiet, 2)).toBe(2)
    expect(asked).toEqual([4, 3])
    expect(await previews(db, folder.id)).toEqual({ 1: '', 2: '', 3: 'three', 4: 'four' })

    expect(await indexBodies(imap, db, folder, quiet, 2)).toBe(2)
    expect(asked).toEqual([4, 3, 2, 1])
    expect(await indexBodies(imap, db, folder, quiet, 2)).toBe(0)
  })

  it('does not fetch what has its text already', async () => {
    const { db, folder } = await folderWith([1, 2])
    await storeBody(db, folder.id, 2, 'kept')
    const { imap, asked } = session({ 1: mail('one'), 2: mail('two') })
    await indexBodies(imap, db, folder, quiet)
    expect(asked).toEqual([1])
  })

  it('stores no text for a message the server does not have, so that it is not asked for again', async () => {
    const { db, folder } = await folderWith([1])
    const { imap, asked } = session({ 1: 'gone' })
    expect(await indexBodies(imap, db, folder, quiet)).toBe(1)
    expect(await indexBodies(imap, db, folder, quiet)).toBe(0)
    expect(asked).toEqual([1])
    expect(await db.get('SELECT body_text FROM messages')).toEqual({ body_text: '' })
  })

  it('does the same for a message that cannot be read, and says so', async () => {
    const { db, folder } = await folderWith([1])
    const said: string[] = []
    const unreadable = {
      get length(): number {
        throw new Error('broken')
      }
    } as unknown as Uint8Array
    const { imap } = session({ 1: unreadable })
    await indexBodies(imap, db, folder, { error: (message) => said.push(message) })
    expect(said).toEqual([expect.stringContaining('could not be read')])
    expect(await db.get('SELECT body_text FROM messages')).toEqual({ body_text: '' })
  })

  it('stops when the connection fails, keeps what was done, and leaves the rest for next time', async () => {
    const { db, folder } = await folderWith([1, 2, 3])
    const said: string[] = []
    const { imap, asked } = session({ 3: mail('three'), 2: new Error('connection closed'), 1: mail('one') })
    expect(await indexBodies(imap, db, folder, { error: (message) => said.push(message) })).toBe(1)
    expect(asked).toEqual([3, 2])
    expect(said).toEqual([expect.stringContaining('connection closed')])
    expect(await previews(db, folder.id)).toEqual({ 1: '', 2: '', 3: 'three' })
    expect(await db.get('SELECT COUNT(*) AS n FROM messages WHERE body_text IS NULL')).toEqual({ n: 2 })
  })

  it('does a batch of a size that is a few trips and not a mailbox', () => {
    expect(INDEX_BATCH).toBeGreaterThan(0)
    expect(INDEX_BATCH).toBeLessThanOrEqual(50)
  })
})

describe('fetching the texts without anybody waiting', () => {
  it('is one run at a time for a folder, and the second asks for nothing', async () => {
    const { db, folder } = await folderWith([1, 2])
    const { imap, asked } = session({ 1: mail('one'), 2: mail('two') })
    const indexer = new BodyIndexer(db, quiet)
    const [first, second] = await Promise.all([indexer.run(imap, folder), indexer.run(imap, folder)])
    expect([first, second]).toEqual([2, 0])
    expect(asked).toEqual([2, 1])
    expect(await indexer.run(imap, folder)).toBe(0)
  })

  it('can run again once a run is over', async () => {
    const { db, folder } = await folderWith([1])
    const indexer = new BodyIndexer(db, quiet)
    expect(await indexer.run(session({ 1: mail('one') }).imap, folder)).toBe(1)
    await db.run('UPDATE messages SET body_text = NULL')
    expect(await indexer.run(session({ 1: mail('one') }).imap, folder)).toBe(1)
  })
})
