import { describe, expect, it } from 'vitest'
import type { FetchedMessage, ImapSession, MailboxEntry } from '@peregrine/core/imapSession'
import { MAX_ATTEMPTS } from '@peregrine/core/pendingActions'
import {
  cancelPendingAction,
  discardFailedActions,
  enqueueAction,
  listPendingActions,
  nextDueAt,
  pendingSummary
} from '@peregrine/core/pendingActionsStore'
import { addAccount, removeAccount, type NewAccount } from './accounts'
import { syncFolders, type Folder } from './folders'
import { listMessages, saveMessages, setPendingMove } from './messages'
import { createQueue } from './queue'
import { migratedDatabase } from './testing/testDb'

/**
 * The offline queue on the phone's own data: the engine of `@peregrine/core` and the storage
 * functions the desktop calls, over this schema and through the adapter that takes positional
 * parameters only. The rules themselves are tested where they are written. What this shows is that
 * they come out the same here: the order, the limit of attempts, a folder that is gone, a message
 * that is scheduled for later.
 */

const newAccount = (over: Partial<NewAccount> = {}): NewAccount => ({
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

const entry = (path: string): MailboxEntry => ({ path, name: path, parentPath: null, flags: [], specialUse: null })
const fetched = (uid: number): FetchedMessage => ({
  uid,
  flags: [],
  size: 10,
  hasAttachment: false,
  envelope: { subject: `s${uid}`, date: new Date(1000 + uid), from: [{ address: 'a@example.net' }] }
})

let counter = 0
const ids = () => `f${++counter}`

async function setup() {
  const made = await migratedDatabase()
  const account = await addAccount(made.db, newAccount())
  const [inbox, archive] = (await syncFolders(made.db, account.id, [entry('INBOX'), entry('Archive')], ids)) as [Folder, Folder]
  const server = { asked: [] as string[], moveFails: null as string | null }
  const imap = {
    addFlags: async (path: string, uid: number, f: string[]) => {
      server.asked.push(`add ${path} ${uid} ${f.join(',')}`)
    },
    removeFlags: async (path: string, uid: number, f: string[]) => {
      server.asked.push(`remove ${path} ${uid} ${f.join(',')}`)
    },
    moveMessages: async (from: string, to: string, uids: number[]) => {
      if (server.moveFails) throw new Error(server.moveFails)
      server.asked.push(`move ${from} > ${to} ${uids.join(',')}`)
      return null
    },
    deleteMessages: async (path: string, uids: number[]) => {
      server.asked.push(`delete ${path} ${uids.join(',')}`)
    }
  } as unknown as ImapSession
  const logs: string[] = []
  const changed = { count: 0 }
  const timers = { pending: new Map<number, { run: () => void; delayMs: number }>(), next: 1 }
  const queue = createQueue(made.db, {
    changed: async () => void changed.count++,
    log: { warn: (m) => logs.push(m), error: (m) => logs.push(m) },
    now: () => 0,
    timers: {
      set: (run, delayMs) => {
        const id = timers.next++
        timers.pending.set(id, { run, delayMs })
        return id
      },
      clear: (id) => void timers.pending.delete(id as number)
    }
  })
  return { ...made, account, inbox, archive, server, imap, queue, logs, changed, timers }
}

const clearMark = (db: Parameters<typeof setPendingMove>[0], folderId: string, uids: number[]) => setPendingMove(db, folderId, uids, null)

describe('the queue on the phone', () => {
  it('replays flags with the path of the folder and takes the action off the queue', async () => {
    const t = await setup()
    await enqueueAction(t.db, t.account.id, 'flags', { folderId: t.inbox.id, uids: [1, 2], add: ['\\Seen'], remove: ['\\Flagged'] })
    await t.queue.flush(t.account.id, t.imap)
    expect(t.server.asked).toEqual(['add INBOX 1 \\Seen', 'remove INBOX 1 \\Flagged', 'add INBOX 2 \\Seen', 'remove INBOX 2 \\Flagged'])
    expect(await listPendingActions(t.db, t.account.id)).toEqual([])
    expect(t.changed.count).toBe(1)
  })

  it('replays a move on the server and only then removes the messages from the source folder', async () => {
    const t = await setup()
    await saveMessages(t.db, t.inbox, [fetched(1), fetched(2)])
    await setPendingMove(t.db, t.inbox.id, [1], t.archive.id)
    await enqueueAction(t.db, t.account.id, 'move', { sourceFolderId: t.inbox.id, targetFolderId: t.archive.id, uids: [1] })

    await t.queue.flush(t.account.id, t.imap)

    expect(t.server.asked).toEqual(['move INBOX > Archive 1'])
    expect((await listMessages(t.db, t.inbox.id)).map((m) => m.uid)).toEqual([2])
  })

  it('keeps a refused move with its reason and its mark, and gives up after the limit', async () => {
    const t = await setup()
    await saveMessages(t.db, t.inbox, [fetched(1)])
    await setPendingMove(t.db, t.inbox.id, [1], t.archive.id)
    await enqueueAction(t.db, t.account.id, 'move', { sourceFolderId: t.inbox.id, targetFolderId: t.archive.id, uids: [1] })
    t.server.moveFails = 'NO mailbox is read-only'

    await t.queue.flush(t.account.id, t.imap)
    const [row] = await listPendingActions(t.db, t.account.id)
    expect(row).toMatchObject({ attempts: 1, lastError: 'NO mailbox is read-only' })
    expect((await listMessages(t.db, t.inbox.id))[0].pendingMoveTo).toBe(t.archive.id)

    for (let i = 1; i < MAX_ATTEMPTS; i++) await t.queue.flush(t.account.id, t.imap)
    // given up: not handed out again, and counted as failed so that it is reported and not lost
    expect(await listPendingActions(t.db, t.account.id)).toEqual([])
    expect((await pendingSummary(t.db)).failed).toBe(1)
    expect((await listMessages(t.db, t.inbox.id))[0].pendingMoveTo).toBe(t.archive.id)

    await discardFailedActions(t.db, clearMark)
    expect((await pendingSummary(t.db)).failed).toBe(0)
    expect((await listMessages(t.db, t.inbox.id))[0].pendingMoveTo).toBeNull()
  })

  it('drops an action whose folder the server no longer lists, without a word to the server', async () => {
    const t = await setup()
    await enqueueAction(t.db, t.account.id, 'delete', { folderId: t.archive.id, uids: [4] })
    // the next folder sync no longer finds Archive
    await syncFolders(t.db, t.account.id, [entry('INBOX')], ids)

    await t.queue.flush(t.account.id, t.imap)

    expect(t.server.asked).toEqual([])
    expect(await listPendingActions(t.db, t.account.id)).toEqual([])
    expect(t.logs.some((m) => m.includes('nothing left to act on'))).toBe(true)
  })

  it('takes the mark off messages when a queued move is cancelled', async () => {
    const t = await setup()
    await saveMessages(t.db, t.inbox, [fetched(1)])
    await setPendingMove(t.db, t.inbox.id, [1], t.archive.id)
    const id = await enqueueAction(t.db, t.account.id, 'move', { sourceFolderId: t.inbox.id, targetFolderId: t.archive.id, uids: [1] })

    await cancelPendingAction(t.db, id, clearMark)

    expect((await listMessages(t.db, t.inbox.id))[0].pendingMoveTo).toBeNull()
    expect(await listPendingActions(t.db, t.account.id)).toEqual([])
  })

  it('replays one account without touching what waits for another', async () => {
    const t = await setup()
    const other = await addAccount(t.db, newAccount({ displayName: 'B' }))
    const [otherInbox] = await syncFolders(t.db, other.id, [entry('INBOX')], ids)
    await enqueueAction(t.db, t.account.id, 'delete', { folderId: t.inbox.id, uids: [1] })
    await enqueueAction(t.db, other.id, 'delete', { folderId: otherInbox.id, uids: [2] })

    await t.queue.flush(t.account.id, t.imap)

    expect(t.server.asked).toEqual(['delete INBOX 1'])
    expect(await listPendingActions(t.db, other.id)).toHaveLength(1)
  })

  it('has nothing to replay for an account that was removed', async () => {
    const t = await setup()
    await enqueueAction(t.db, t.account.id, 'delete', { folderId: t.inbox.id, uids: [1] })
    await removeAccount(t.db, t.account.id)
    await t.queue.flush(t.account.id, t.imap)
    expect(t.server.asked).toEqual([])
  })

  it('keeps a message scheduled for later out of the replay, and wakes the queue for it', async () => {
    const t = await setup()
    const due = Date.now() + 3 * 3600_000
    await enqueueAction(t.db, t.account.id, 'send', { input: { subject: 'Monday' } as never }, due)
    await enqueueAction(t.db, t.account.id, 'delete', { folderId: t.inbox.id, uids: [1] })

    // the scheduled one is passed over and keeps its place, the one behind it still runs
    await t.queue.flush(t.account.id, t.imap)
    expect(t.server.asked).toEqual(['delete INBOX 1'])
    expect((await listPendingActions(t.db, t.account.id)).length).toBe(0)
    expect((await pendingSummary(t.db)).scheduled).toBe(1)
    expect(await nextDueAt(t.db)).toBe(due)

    await t.queue.rescheduleDue(() => undefined)
    expect([...t.timers.pending.values()].map((x) => x.delayMs)).toEqual([Math.min(due + 1000, 24 * 3600_000)])
  })
})
