import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type {
  EnvelopeAddress,
  FetchedMessage,
  ImapSession,
  ImapSessionOptions
} from '@peregrine/core/imapSession'
import { ImapClientSession } from '@peregrine/imap/session'
import { closeDb, openDb } from '../db/db'
import { insertAccount } from '../db/repositories/accountsRepo'
import { syncFolderEnvelopes, syncFolderList } from './syncEngine'
import { ImapConnection } from './ImapConnection'
import { NodeTransport } from './NodeTransport'

/**
 * The same scenarios, run through imapflow and through the client from @peregrine/imap, against a
 * real server, and the answers compared.
 *
 * This is the test that decides whether the new client may replace the old one. Fixtures and a
 * scripted server show that it does what its author expects. They cannot show that it does what the
 * library it replaces does, which is the only standard that matters to somebody whose mail has to
 * keep arriving.
 *
 * It needs a server, and it is skipped without one. Give it one through the environment:
 *
 *   IMAP_TEST_HOST, IMAP_TEST_USER, IMAP_TEST_PASSWORD
 *   IMAP_TEST_PORT          implicit TLS, default 993
 *   IMAP_TEST_STARTTLS_PORT a port that starts in the clear and offers STARTTLS (optional)
 *
 * A server with a certificate of its own needs NODE_TLS_REJECT_UNAUTHORIZED=0 for the whole run.
 * Nothing in the application can switch certificate checking off, so this is deliberately done
 * outside it.
 *
 * It only touches folders it creates itself, named `peregrine-conformance-…`, and removes them at
 * the end. It is safe to point at a real account, and it is better pointed at a throwaway one.
 */

const env = process.env
const configured = Boolean(env.IMAP_TEST_HOST && env.IMAP_TEST_USER && env.IMAP_TEST_PASSWORD)

const options = (secure: ImapSessionOptions['secure'], port: number): ImapSessionOptions => ({
  host: env.IMAP_TEST_HOST as string,
  port,
  secure,
  username: env.IMAP_TEST_USER as string,
  password: env.IMAP_TEST_PASSWORD as string
})

const tlsPort = Number(env.IMAP_TEST_PORT ?? 993)
const starttlsPort = env.IMAP_TEST_STARTTLS_PORT ? Number(env.IMAP_TEST_STARTTLS_PORT) : null

type Kind = 'imapflow' | 'own'

function create(kind: Kind, secure: ImapSessionOptions['secure'] = 'tls', port = tlsPort): ImapSession {
  const settings = options(secure, port)
  return kind === 'imapflow'
    ? new ImapConnection(settings)
    : new ImapClientSession(settings, { transport: new NodeTransport() })
}

const corpusDirectory = join(__dirname, '..', '..', '..', 'packages', 'imap', 'fixtures', 'mail')
const corpus = readdirSync(corpusDirectory)
  .filter((name) => name.endsWith('.eml'))
  .sort()
  .map((name) => ({
    name,
    source: Buffer.from(readFileSync(join(corpusDirectory, name), 'utf8').replace(/\r?\n/g, '\r\n'), 'utf8')
  }))

/**
 * `\Recent` belongs to one connection: the server says it to the first that sees a message and to
 * no other, so which client is shown it depends on which got there first. The new client leaves
 * it out, imapflow does not, and the comparison ignores it.
 */
const withoutRecent = (flags: string[]): string[] => flags.filter((f) => f.toLowerCase() !== '\\recent')

/** Addresses compared the way a person would: no empty names, and without the group markers. */
function people(list: EnvelopeAddress[] | undefined): { name?: string; address?: string }[] {
  return (list ?? [])
    .filter((a) => !(a.address ?? '').endsWith('@'))
    .map((a) => ({ ...(a.name ? { name: a.name } : {}), address: a.address }))
}

function comparable(message: FetchedMessage): unknown {
  const e = message.envelope
  return {
    uid: message.uid,
    flags: withoutRecent(message.flags).sort(),
    size: message.size,
    hasAttachment: message.hasAttachment,
    envelope: {
      subject: e.subject,
      messageId: e.messageId,
      inReplyTo: e.inReplyTo,
      date: e.date?.getTime(),
      from: people(e.from),
      to: people(e.to),
      cc: people(e.cc),
      bcc: people(e.bcc)
    }
  }
}

describe.skipIf(!configured)('the two clients, against a real server', { timeout: 60_000 }, () => {
  const prefix = `peregrine-conformance-${Date.now().toString(36)}`
  let flow: ImapSession
  let own: ImapSession
  let delimiter: string
  let a: string
  let b: string
  let child: string
  let synced: string
  const uids = new Map<string, number>()

  beforeAll(async () => {
    flow = create('imapflow')
    own = create('own')
    await Promise.all([flow.connect(), own.connect()])
    delimiter = await own.pathDelimiter()
    a = `${prefix}-a`
    b = `${prefix}-b`
    child = `${a}${delimiter}child`
    synced = `${prefix}-sync`
    await own.createMailbox(synced)
    for (const { source } of corpus) await own.appendMessage(synced, source, ['\\Seen'])
    await own.createMailbox(a)
    await own.createMailbox(b)
    await own.createMailbox(child)
    for (const { name, source } of corpus) {
      const uid = await own.appendMessage(a, source, ['\\Seen'])
      expect(uid, `APPENDUID for ${name}`).toBeGreaterThan(0)
      uids.set(name, uid as number)
    }
  }, 60_000)

  afterAll(async () => {
    for (const path of [child, a, b, synced]) {
      await own.deleteMailbox(path).catch(() => undefined)
    }
    await Promise.all([flow?.disconnect(), own?.disconnect()])
  }, 60_000)

  it('agree on the hierarchy delimiter', async () => {
    expect(await own.pathDelimiter()).toBe(await flow.pathDelimiter())
  })

  it('list the same folders, with the same names, parents and roles', async () => {
    const mine = (await own.listMailboxes()).filter((m) => m.path.startsWith(prefix))
    const theirs = (await flow.listMailboxes()).filter((m) => m.path.startsWith(prefix))
    const shape = (list: typeof mine) =>
      list
        .map((m) => ({ path: m.path, name: m.name, parentPath: m.parentPath, specialUse: m.specialUse }))
        .sort((x, y) => x.path.localeCompare(y.path))

    expect(shape(mine)).toEqual(shape(theirs))
    expect(mine.map((m) => m.path).sort()).toEqual([a, child, b, synced].sort())
    expect(mine.find((m) => m.path === child)).toMatchObject({ parentPath: a })
  })

  it('both find INBOX and the same special folders', async () => {
    const roles = async (session: ImapSession) =>
      (await session.listMailboxes())
        .filter((m) => m.specialUse)
        .map((m) => `${m.path}=${m.specialUse}`)
        .sort()
    expect(await roles(own)).toEqual(await roles(flow))
    expect((await own.listMailboxes()).some((m) => m.path.toUpperCase() === 'INBOX')).toBe(true)
  })

  it('report the same state of a folder', async () => {
    const mine = await own.mailboxStatus(a)
    const theirs = await flow.mailboxStatus(a)
    expect(mine).toEqual(theirs)
    expect(mine.messages).toBe(corpus.length)
  })

  it('fetch the same envelopes, flags and attachment hints', async () => {
    const range = (status: { uidNext: number }) => `1:${status.uidNext - 1}`
    const mine = await own.syncFetch(a, range)
    const theirs = await flow.syncFetch(a, range)

    expect(mine.uidValidity).toBe(theirs.uidValidity)
    expect(mine.uidNext).toBe(theirs.uidNext)
    expect(mine.messages.map(comparable)).toEqual(theirs.messages.map(comparable))
    expect([...mine.flags].sort((x, y) => x.uid - y.uid)).toEqual(
      [...theirs.flags].sort((x, y) => x.uid - y.uid)
    )
    expect(mine.messages).toHaveLength(corpus.length)
  })

  // The whole way in, through the sync engine and into the database, one fresh database each. What
  // is stored is what the application shows, so this is the comparison that matters most.
  it('leave the same rows in the database after a folder sync', async () => {
    async function rowsAfterSyncingWith(session: ImapSession): Promise<unknown[]> {
      const db = openDb(':memory:', null)
      try {
        const accountId = await insertAccount(db, {
          displayName: 'x',
          emailAddress: 'x@example.com',
          imapHost: 'h',
          imapPort: 993,
          imapSecure: 'tls',
          imapUsername: 'x',
          smtpHost: 'h',
          smtpPort: 465,
          smtpSecure: 'tls',
          smtpUsername: 'x'
        })
        await syncFolderList(db, accountId, session)
        const first = await syncFolderEnvelopes(db, accountId, session, synced)
        expect(first.newCount).toBe(corpus.length)
        // A second sync of an unchanged folder finds nothing new, and changes nothing.
        const second = await syncFolderEnvelopes(db, accountId, session, synced)
        expect(second.newCount).toBe(0)

        const rows = await db.all<Record<string, unknown>>(
          `SELECT m.uid, m.subject, m.from_name, m.from_address, m.to_addresses, m.cc_addresses,
                  m.bcc_addresses, m.date, m.is_read, m.is_flagged, m.has_attachments, m.size_bytes,
                  m.flags, m.message_id_header, m.in_reply_to, f.imap_path, f.special_use
           FROM messages m JOIN folders f ON f.id = m.folder_id
           WHERE f.imap_path = ? ORDER BY m.uid`,
          synced
        )
        const addresses = (json: unknown): unknown =>
          people(JSON.parse(String(json)) as EnvelopeAddress[])
        return rows.map((row) => ({
          ...row,
          to_addresses: addresses(row.to_addresses),
          cc_addresses: addresses(row.cc_addresses),
          bcc_addresses: addresses(row.bcc_addresses),
          flags: withoutRecent(JSON.parse(String(row.flags)) as string[]).sort()
        }))
      } finally {
        closeDb()
      }
    }

    const mine = await rowsAfterSyncingWith(own)
    const theirs = await rowsAfterSyncingWith(flow)

    expect(mine).toHaveLength(corpus.length)
    expect(mine).toEqual(theirs)
  })

  it('fetch only what the caller asked for', async () => {
    const last = uids.get(corpus[corpus.length - 1].name) as number
    const mine = await own.syncFetch(a, () => `${last}:*`)
    const theirs = await flow.syncFetch(a, () => `${last}:*`)
    expect(mine.messages.map((m) => m.uid)).toEqual(theirs.messages.map((m) => m.uid))
    expect(mine.flags).toHaveLength(corpus.length)
  })

  it('fetch every message byte for byte', async () => {
    for (const { name, source } of corpus) {
      const uid = uids.get(name) as number
      const mine = await own.fetchFullMessage(a, uid)
      const theirs = await flow.fetchFullMessage(a, uid)
      expect(Buffer.from(mine!.source).equals(source), `${name} through own`).toBe(true)
      expect(Buffer.from(theirs!.source).equals(source), `${name} through imapflow`).toBe(true)
    }
  })

  it('agree that a message that is not there is not there', async () => {
    expect(await own.fetchFullMessage(a, 99999)).toBeUndefined()
    expect(await flow.fetchFullMessage(a, 99999)).toBeUndefined()
  })

  it('change flags so that the other one sees the same', async () => {
    const first = uids.get(corpus[0].name) as number
    const second = uids.get(corpus[1].name) as number
    const flagsOf = async (session: ImapSession, uid: number) =>
      withoutRecent(
        (await session.syncFetch(a, () => `${uid}:${uid}`)).messages.find((m) => m.uid === uid)?.flags ?? []
      ).sort()

    await own.addFlags(a, first, ['\\Flagged', 'peregrineone'])
    expect(await flagsOf(flow, first)).toEqual(['\\Flagged', '\\Seen', 'peregrineone'])
    await flow.removeFlags(a, first, ['peregrineone'])
    expect(await flagsOf(own, first)).toEqual(['\\Flagged', '\\Seen'])
    await own.setFlags(a, first, [])
    expect(await flagsOf(flow, first)).toEqual([])
    await flow.setFlags(a, second, ['\\Seen', '\\Answered'])
    expect(await flagsOf(own, second)).toEqual(['\\Answered', '\\Seen'])
    await own.setFlags(a, first, ['\\Seen'])
    await own.setFlags(a, second, ['\\Seen'])
  })

  it('move messages and report where they went', async () => {
    const x = uids.get(corpus[2].name) as number
    const y = uids.get(corpus[3].name) as number
    const before = (await own.mailboxStatus(b)).uidNext

    const mine = await own.moveMessages(a, b, [x])
    const theirs = await flow.moveMessages(a, b, [y])

    expect(mine).toEqual(new Map([[x, before]]))
    expect(theirs).toEqual(new Map([[y, before + 1]]))
    expect((await own.mailboxStatus(a)).messages).toBe(corpus.length - 2)
    expect((await flow.mailboxStatus(b)).messages).toBe(2)
    expect(await own.fetchFullMessage(a, x)).toBeUndefined()
    expect(Buffer.from((await flow.fetchFullMessage(b, before))!.source).equals(corpus[2].source)).toBe(true)
  })

  it('append and report the UID', async () => {
    const draft = Buffer.from('From: me@example.com\r\nSubject: draft\r\n\r\nbody\r\n')
    const one = await own.appendMessage(b, draft, ['\\Draft', '\\Seen'])
    const two = await flow.appendMessage(b, draft, ['\\Draft', '\\Seen'])
    expect(one).toBeGreaterThan(0)
    expect(two).toBe((one as number) + 1)
    const stored = (await own.syncFetch(b, (s) => `${one}:${s.uidNext}`)).messages
    expect(stored.map((m) => withoutRecent(m.flags).sort())).toEqual([
      ['\\Draft', '\\Seen'],
      ['\\Draft', '\\Seen']
    ])
  })

  it('delete messages for good', async () => {
    const z = uids.get(corpus[4].name) as number
    const w = uids.get(corpus[5].name) as number
    await own.deleteMessages(a, [z])
    await flow.deleteMessages(a, [w])
    const left = (await own.syncFetch(a, () => '1:*')).messages.map((m) => m.uid)
    expect(left).not.toContain(z)
    expect(left).not.toContain(w)
    expect(await flow.mailboxStatus(a)).toEqual(await own.mailboxStatus(a))
  })

  it('empty a folder', async () => {
    const mineTotal = (await own.mailboxStatus(b)).messages
    expect(await own.purgeMailbox(b)).toBe(mineTotal)
    expect((await flow.mailboxStatus(b)).messages).toBe(0)
    await own.appendMessage(b, Buffer.from('Subject: x\r\n\r\ny\r\n'))
    expect(await flow.purgeMailbox(b)).toBe(1)
    expect((await own.mailboxStatus(b)).messages).toBe(0)
  })

  it('rename a folder', async () => {
    const renamed = `${prefix}-renamed`
    await own.renameMailbox(b, renamed)
    expect((await flow.listMailboxes()).some((m) => m.path === renamed)).toBe(true)
    await flow.renameMailbox(renamed, b)
    expect((await own.listMailboxes()).some((m) => m.path === b)).toBe(true)
  })

  // A known difference, and in the new client's favour. imapflow's error is "Command failed", which
  // is what the interface would show for a folder that does not exist. The new client says what
  // happened with a code the interface has a translated sentence for.
  it('refuse a folder that is not there, the new one in words the interface knows', async () => {
    const missing = `${prefix}-missing`
    const messageOf = async (session: ImapSession) =>
      session.fetchFullMessage(missing, 1).then(
        () => 'resolved',
        (error: Error) => error.message
      )
    expect(await messageOf(own)).toBe(`mailboxOpenFailed:${missing}`)
    expect(await messageOf(flow)).not.toBe('resolved')
  })

  it('refuse the same wrong password', async () => {
    for (const kind of ['imapflow', 'own'] as const) {
      const session =
        kind === 'imapflow'
          ? new ImapConnection({ ...options('tls', tlsPort), password: 'definitely-wrong' })
          : new ImapClientSession(
              { ...options('tls', tlsPort), password: 'definitely-wrong' },
              { transport: new NodeTransport() }
            )
      await expect(session.connect(), kind).rejects.toThrow()
      await session.disconnect()
    }
  })

  // How long each takes to start listening. The new client parks two seconds after its last
  // command. imapflow starts IDLE by itself after fifteen seconds of quiet, and until it has, an
  // arrival goes unnoticed because it is not asking anything.
  it.each([
    ['own', 3500],
    ['imapflow', 17_000]
  ] as const)('tell a watching client (%s) about an arrival', async (kind, settle) => {
    const watcher = kind === 'own' ? own : flow
    const other = kind === 'own' ? flow : own
    let arrivals = 0
    watcher.watchMailbox(a, () => arrivals++)
    await new Promise((resolve) => setTimeout(resolve, settle))
    await other.appendMessage(a, Buffer.from(`Subject: ${kind}\r\n\r\nhi\r\n`))
    for (let i = 0; i < 50 && arrivals === 0; i++) await new Promise((r) => setTimeout(r, 100))
    expect(arrivals).toBeGreaterThanOrEqual(1)
  }, 40_000)

  it.runIf(starttlsPort !== null)('connect with STARTTLS, and fail where it is missing', async () => {
    for (const kind of ['imapflow', 'own'] as const) {
      const session = create(kind, 'starttls', starttlsPort as number)
      await session.connect()
      expect((await session.listMailboxes()).length).toBeGreaterThan(0)
      await session.disconnect()
    }
    // Port 993 starts with TLS already, and has no STARTTLS to offer on top of it.
    for (const kind of ['imapflow', 'own'] as const) {
      const session = create(kind, 'starttls', tlsPort)
      await expect(session.connect(), kind).rejects.toThrow()
      await session.disconnect()
    }
  })
})
