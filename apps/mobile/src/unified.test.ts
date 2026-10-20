import { describe, expect, it } from 'vitest'
import type { FetchedMessage, ImapSession, MailboxEntry } from '@peregrine/core/imapSession'
import { addAccount, listAccounts, type NewAccount } from './accounts'
import { Connections } from './connections'
import { syncFolders } from './folders'
import { MailActions } from './mailActions'
import { saveMessages } from './messages'
import { createQueue } from './queue'
import { migratedDatabase } from './testing/testDb'
import { isInbox, listUnified, refreshInboxes } from './unified'

const newAccount = (name: string): NewAccount => ({
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
const fetched = (uid: number, date: Date | null, subject = `s${uid}`): FetchedMessage => ({
  uid,
  flags: [],
  size: 10,
  hasAttachment: false,
  envelope: { subject, date: date ?? undefined, from: [{ address: 'a@example.net' }] }
})

let counter = 0
const ids = () => `f${++counter}`
const day = (n: number) => new Date(Date.UTC(2026, 9, n))

describe('which folder is an inbox', () => {
  it('is the one the server calls so, or the one called INBOX in any case', () => {
    expect(isInbox({ specialUse: '\\Inbox', imapPath: 'Eingang' })).toBe(true)
    expect(isInbox({ specialUse: null, imapPath: 'inbox' })).toBe(true)
    expect(isInbox({ specialUse: null, imapPath: 'INBOX/Work' })).toBe(false)
    expect(isInbox({ specialUse: '\\Sent', imapPath: 'Sent' })).toBe(false)
  })
})

describe('the unified list', () => {
  async function twoAccounts() {
    const made = await migratedDatabase()
    const a = await addAccount(made.db, newAccount('Work'), { now: 1 })
    const b = await addAccount(made.db, newAccount('Home'), { now: 2 })
    const [aInbox, aSent] = await syncFolders(made.db, a.id, [entry('INBOX', '\\Inbox'), entry('Sent', '\\Sent')], ids)
    const [bInbox] = await syncFolders(made.db, b.id, [entry('INBOX')], ids)
    return { ...made, a, b, aInbox, aSent, bInbox }
  }

  it('merges the inboxes of the accounts by date, newest first, each with its account', async () => {
    const t = await twoAccounts()
    await saveMessages(t.db, t.aInbox, [fetched(1, day(1)), fetched(2, day(5))])
    await saveMessages(t.db, t.bInbox, [fetched(1, day(3)), fetched(2, day(7))])

    const list = await listUnified(t.db)

    expect(list.map((m) => [m.accountName, m.uid, m.dateMs])).toEqual([
      ['Home', 2, day(7).getTime()],
      ['Work', 2, day(5).getTime()],
      ['Home', 1, day(3).getTime()],
      ['Work', 1, day(1).getTime()]
    ])
    expect(list[0]).toMatchObject({ accountId: t.b.id, folderId: t.bInbox.id })
    // each message has the colour of its account, which differ
    expect(list[0].accountColor).toBe(t.b.color)
    expect(list[1].accountColor).toBe(t.a.color)
    expect(t.a.color).not.toBe(t.b.color)
  })

  it('leaves out every other folder', async () => {
    const t = await twoAccounts()
    await saveMessages(t.db, t.aInbox, [fetched(1, day(1))])
    await saveMessages(t.db, t.aSent, [fetched(1, day(9), 'sent')])
    expect((await listUnified(t.db)).map((m) => m.subject)).toEqual(['s1'])
  })

  it('puts a message with no date last, and orders the same date by UID', async () => {
    const t = await twoAccounts()
    await saveMessages(t.db, t.aInbox, [fetched(1, null), fetched(2, day(2)), fetched(3, day(2))])
    expect((await listUnified(t.db)).map((m) => m.uid)).toEqual([3, 2, 1])
  })

  it('shows no more than it was asked to', async () => {
    const t = await twoAccounts()
    await saveMessages(t.db, t.aInbox, [1, 2, 3, 4].map((uid) => fetched(uid, day(uid))))
    expect((await listUnified(t.db, 2)).map((m) => m.uid)).toEqual([4, 3])
  })

  it('keeps the mark of a queued move, and has nothing for no accounts', async () => {
    const empty = await migratedDatabase()
    expect(await listUnified(empty.db)).toEqual([])
    const t = await twoAccounts()
    await saveMessages(t.db, t.aInbox, [fetched(1, day(1))])
    t.raw.prepare('UPDATE messages SET pending_move_to = ?').run('somewhere')
    expect((await listUnified(t.db))[0].pendingMoveTo).toBe('somewhere')
  })
})

describe('bringing the inboxes up to date', () => {
  async function setup(unreachable: string[] = []) {
    const made = await migratedDatabase()
    const a = await addAccount(made.db, newAccount('Work'), { now: 1 })
    const b = await addAccount(made.db, newAccount('Home'), { now: 2 })
    const served: Record<string, FetchedMessage[]> = {
      Work: [fetched(1, day(1), 'from work')],
      Home: [fetched(1, day(2), 'from home')]
    }
    const asked: string[] = []
    const connections = new Connections(async (account) => {
      if (unreachable.includes(account.displayName)) throw new Error(`${account.displayName} refused the connection`)
      asked.push(`connect ${account.displayName}`)
      return {
        onClose: () => undefined,
        disconnect: async () => undefined,
        listMailboxes: async () => {
          asked.push(`list ${account.displayName}`)
          return [entry('INBOX', '\\Inbox'), entry('Archive')]
        },
        syncFetch: async (path: string, decide: (s: { uidValidity: bigint; uidNext: number }) => string) => {
          asked.push(`fetch ${account.displayName} ${path} ${decide({ uidValidity: 1n, uidNext: 100 })}`)
          return { messages: served[account.displayName] }
        }
      } as unknown as ImapSession
    })
    const queue = createQueue(made.db, { changed: async () => undefined, log: { warn: () => undefined, error: () => undefined } })
    const mail = new MailActions({ db: made.db, queue, session: (id) => connections.get(id), log: { error: () => undefined } })
    return { ...made, a, b, asked, connections, mail }
  }

  it('connects each account, takes its folders and fetches its inbox', async () => {
    const t = await setup()
    const results = await refreshInboxes(t, await listAccounts(t.db))

    expect(results).toEqual([
      { accountId: t.a.id, accountName: 'Work' },
      { accountId: t.b.id, accountName: 'Home' }
    ])
    expect(t.asked.filter((x) => x.includes('Work'))).toEqual(['connect Work', 'list Work', 'fetch Work INBOX 50:*'])
    expect((await listUnified(t.db)).map((m) => m.subject)).toEqual(['from home', 'from work'])
  })

  it('names the account that cannot be reached, and the others are not held up', async () => {
    const t = await setup(['Home'])
    const results = await refreshInboxes(t, await listAccounts(t.db))

    expect(results[0].error).toBeUndefined()
    expect(results[1]).toMatchObject({
      accountName: 'Home',
      error: 'Der Server ist nicht erreichbar. (Home refused the connection)'
    })
    expect((await listUnified(t.db)).map((m) => m.subject)).toEqual(['from work'])
  })

  it('gives up on an account that does not answer, and says for how long it waited', async () => {
    const t = await setup()
    const slow = new Connections(() => new Promise<ImapSession>(() => undefined))
    const results = await refreshInboxes({ ...t, connections: slow, timeoutMs: 20 }, [t.a])
    expect(results[0].error).toMatch(/Keine Antwort/)
  })

  it('uses the connection an account already has', async () => {
    const t = await setup()
    await refreshInboxes(t, await listAccounts(t.db))
    await refreshInboxes(t, await listAccounts(t.db))
    expect(t.asked.filter((x) => x.startsWith('connect'))).toEqual(['connect Work', 'connect Home'])
  })
})
