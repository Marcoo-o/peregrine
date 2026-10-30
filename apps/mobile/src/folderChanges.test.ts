import { describe, expect, it } from 'vitest'
import type { FetchedMessage, ImapSession } from '@peregrine/core/imapSession'
import { enqueueAction, listPendingActions } from '@peregrine/core/pendingActionsStore'
import type { ComposeInput } from '@peregrine/core/types'
import { addAccount } from './accounts'
import { cachedBounds, hasOlder, knownUidValidity, reconcile, rememberUidValidity, resetFolder, resetText } from './folderChanges'
import { syncFolders, type Folder } from './folders'
import { listMessages, saveMessages } from './messages'
import { loadOlder, NEWEST, PAGE, syncFolder } from './sync'
import { migratedDatabase } from './testing/testDb'

const fetched = (uid: number, flags: string[] = []): FetchedMessage => ({
  uid,
  flags,
  size: 1,
  hasAttachment: false,
  envelope: { subject: `s${uid}`, date: new Date(2026, 9, 1), from: [{ address: 'x@sender.test' }] }
})

async function setup() {
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
  const entry = (path: string, specialUse: string | null) => ({ path, name: path, parentPath: null, flags: [], specialUse })
  const [inbox, drafts] = await syncFolders(db, account.id, [entry('INBOX', '\\Inbox'), entry('Drafts', '\\Drafts')])
  return { db, account, inbox, drafts }
}

/**
 * A server with one folder, which says what its UIDVALIDITY and UIDNEXT are, gives the headers of the range it is asked for and the flags of
 * everything it has, as a sync does, and gives the headers of UIDs it is asked for by number.
 */
function server(state: { uidValidity: bigint; uidNext: number; messages: FetchedMessage[] }) {
  const asked: string[] = []
  const fetchedByNumber: number[][] = []
  const session = {
    syncFetch: async (_path: string, decide: (s: { uidValidity: bigint; uidNext: number }) => string | Promise<string>) => {
      const range = await decide({ uidValidity: state.uidValidity, uidNext: state.uidNext })
      asked.push(range)
      const first = Number(range.split(':')[0])
      return {
        uidValidity: state.uidValidity,
        uidNext: state.uidNext,
        messages: state.messages.filter((m) => m.uid >= first),
        flags: state.messages.map((m) => ({ uid: m.uid, flags: m.flags }))
      }
    },
    fetchMessages: async (_path: string, uids: number[]) => {
      fetchedByNumber.push(uids)
      return state.messages.filter((m) => uids.includes(m.uid))
    }
  } as unknown as ImapSession
  return { session, asked, fetchedByNumber }
}

const uidsOf = async (db: Awaited<ReturnType<typeof setup>>['db'], folder: Folder) => (await listMessages(db, folder.id)).map((m) => m.uid).sort((a, b) => a - b)

const input = (accountId: string): ComposeInput => ({ accountId, to: [], cc: [], bcc: [], subject: 'x', textBody: 'y', htmlBody: '', attachments: [] })

describe('the UIDVALIDITY of a folder', () => {
  it('is not known before the folder is synced, and is known after, as the server said it', async () => {
    const t = await setup()
    expect(await knownUidValidity(t.db, t.inbox.id)).toBeNull()
    await syncFolder(server({ uidValidity: 4_000_000_007n, uidNext: 3, messages: [fetched(1), fetched(2)] }).session, t.db, t.inbox)
    expect(await knownUidValidity(t.db, t.inbox.id)).toBe('4000000007')
  })

  it('is kept for each folder', async () => {
    const t = await setup()
    await rememberUidValidity(t.db, t.inbox.id, 5n)
    expect(await knownUidValidity(t.db, t.drafts.id)).toBeNull()
  })
})

describe('a folder that the server numbered anew', () => {
  it('is forgotten and fetched again: what the phone kept of it is not what the numbers say', async () => {
    const t = await setup()
    const old = server({ uidValidity: 1n, uidNext: 4, messages: [fetched(1), fetched(2), fetched(3)] })
    await syncFolder(old.session, t.db, t.inbox)
    const reset: unknown[] = []
    const renumbered = server({ uidValidity: 2n, uidNext: 3, messages: [fetched(1, ['\\Seen']), fetched(2)] })
    await syncFolder(renumbered.session, t.db, t.inbox, (r) => reset.push(r))
    expect(await uidsOf(t.db, t.inbox)).toEqual([1, 2])
    expect(reset).toEqual([{ messages: 3, actions: 0 }])
    expect(await knownUidValidity(t.db, t.inbox.id)).toBe('2')
  })

  it('is left as it is when the server says the same', async () => {
    const t = await setup()
    const same = server({ uidValidity: 1n, uidNext: 3, messages: [fetched(1), fetched(2)] })
    await syncFolder(same.session, t.db, t.inbox)
    const reset: unknown[] = []
    await syncFolder(same.session, t.db, t.inbox, (r) => reset.push(r))
    expect(reset).toEqual([])
  })

  it('is not taken for numbered anew the first time it is synced, when nothing is known of it', async () => {
    const t = await setup()
    await saveMessages(t.db, t.inbox, [fetched(1)])
    const reset: unknown[] = []
    await syncFolder(server({ uidValidity: 9n, uidNext: 2, messages: [fetched(1)] }).session, t.db, t.inbox, (r) => reset.push(r))
    expect(reset).toEqual([])
  })

  it('does not keep the changes that waited to be made to its messages, which would be made to others', async () => {
    const t = await setup()
    await rememberUidValidity(t.db, t.inbox.id, 1n)
    await saveMessages(t.db, t.inbox, [fetched(5)])
    await enqueueAction(t.db, t.account.id, 'flags', { folderId: t.inbox.id, uids: [5], add: ['\\Flagged'], remove: [] })
    await enqueueAction(t.db, t.account.id, 'delete', { folderId: t.inbox.id, uids: [5] })
    await enqueueAction(t.db, t.account.id, 'move', { sourceFolderId: t.inbox.id, targetFolderId: t.drafts.id, uids: [5] })
    // What is about another folder, and what is a message that has never been sent, stays.
    await enqueueAction(t.db, t.account.id, 'flags', { folderId: t.drafts.id, uids: [5], add: ['x'], remove: [] })
    await enqueueAction(t.db, t.account.id, 'send', { input: input(t.account.id) })

    const reset = await resetFolder(t.db, t.inbox)
    expect(reset).toEqual({ messages: 1, actions: 3 })
    expect((await listPendingActions(t.db, t.account.id)).map((a) => a.kind)).toEqual(['flags', 'send'])
  })

  it('keeps a draft that waited to replace a revision in it, as a draft that replaces nothing', async () => {
    const t = await setup()
    await enqueueAction(t.db, t.account.id, 'saveDraft', {
      draftKey: 'k',
      input: input(t.account.id),
      replace: { folderId: t.drafts.id, uid: 7 }
    })
    const reset = await resetFolder(t.db, t.drafts)
    expect(reset.actions).toBe(0)
    const [action] = await listPendingActions(t.db, t.account.id)
    expect(action.kind).toBe('saveDraft')
    expect(action.payload).toMatchObject({ draftKey: 'k' })
    expect((action.payload as { replace?: unknown }).replace).toBeUndefined()
  })

  it('says in the log what it cost', async () => {
    const t = await setup()
    expect(resetText(t.inbox, { messages: 3, actions: 2 })).toBe(
      'The server numbered the folder INBOX anew: the phone forgot 3 messages of it and gave up 2 changes that waited for them'
    )
  })
})

const many = (from: number, to: number): FetchedMessage[] => Array.from({ length: to - from + 1 }, (_, i) => fetched(from + i))

describe('messages that the server no longer has', () => {
  it('are taken out of the list by the next sync', async () => {
    const t = await setup()
    const state = { uidValidity: 1n, uidNext: 5, messages: [fetched(1), fetched(2), fetched(3), fetched(4)] }
    await syncFolder(server(state).session, t.db, t.inbox)
    expect(await uidsOf(t.db, t.inbox)).toEqual([1, 2, 3, 4])
    // 2 and 3 were deleted on another device.
    state.messages = [fetched(1), fetched(4)]
    await syncFolder(server(state).session, t.db, t.inbox)
    expect(await uidsOf(t.db, t.inbox)).toEqual([1, 4])
  })

  it('are taken out whatever their age, and not only those of the newest range', async () => {
    const t = await setup()
    await saveMessages(t.db, t.inbox, [fetched(3), fetched(4)])
    const state = { uidValidity: 1n, uidNext: 400, messages: [fetched(4), fetched(399)] }
    await syncFolder(server(state).session, t.db, t.inbox)
    expect(await uidsOf(t.db, t.inbox)).toEqual([4, 399])
  })

  it('are taken out when the folder is empty now', async () => {
    const t = await setup()
    await syncFolder(server({ uidValidity: 1n, uidNext: 3, messages: [fetched(1), fetched(2)] }).session, t.db, t.inbox)
    await syncFolder(server({ uidValidity: 1n, uidNext: 3, messages: [] }).session, t.db, t.inbox)
    expect(await uidsOf(t.db, t.inbox)).toEqual([])
  })
})

describe('what was read or starred elsewhere', () => {
  it('shows so after a sync, for a message that is not new', async () => {
    const t = await setup()
    const state = { uidValidity: 1n, uidNext: 4, messages: [fetched(1), fetched(2), fetched(3)] }
    await syncFolder(server(state).session, t.db, t.inbox)
    state.messages = [fetched(1, ['\\Seen']), fetched(2, ['\\Flagged']), fetched(3)]
    await syncFolder(server(state).session, t.db, t.inbox)
    const flags = Object.fromEntries((await listMessages(t.db, t.inbox.id)).map((m) => [m.uid, m.flags]))
    expect(flags).toEqual({ 1: ['\\Seen'], 2: ['\\Flagged'], 3: [] })
  })

  it('does not undo a change that the queue has not told the server yet', async () => {
    const t = await setup()
    await saveMessages(t.db, t.inbox, [fetched(1), fetched(2)])
    await saveMessages(t.db, t.inbox, [fetched(2, ['\\Seen'])])
    await enqueueAction(t.db, t.account.id, 'flags', { folderId: t.inbox.id, uids: [2], add: ['\\Seen'], remove: [] })
    const reconciled = await reconcile(t.db, t.inbox, [
      { uid: 1, flags: ['\\Seen'] },
      { uid: 2, flags: [] }
    ])
    expect(reconciled).toEqual({ gone: 0, changed: 1 })
    const flags = Object.fromEntries((await listMessages(t.db, t.inbox.id)).map((m) => [m.uid, m.flags]))
    expect(flags).toEqual({ 1: ['\\Seen'], 2: ['\\Seen'] })
  })

  it('is no change when the flags are the same in another order', async () => {
    const t = await setup()
    await saveMessages(t.db, t.inbox, [fetched(1, ['\\Seen', '\\Flagged'])])
    expect(await reconcile(t.db, t.inbox, [{ uid: 1, flags: ['\\Flagged', '\\Seen'] }])).toEqual({ gone: 0, changed: 0 })
  })
})

describe('what is new since the last sync', () => {
  it('is fetched from the newest message the phone has on, and not the newest 50 again', async () => {
    const t = await setup()
    const state = { uidValidity: 1n, uidNext: 101, messages: many(1, 100) }
    const first = server(state)
    await syncFolder(first.session, t.db, t.inbox)
    expect(first.asked).toEqual([`${101 - NEWEST}:*`])
    state.uidNext = 104
    state.messages = many(1, 103)
    const second = server(state)
    expect(await syncFolder(second.session, t.db, t.inbox)).toBe(3)
    expect(second.asked).toEqual(['101:*'])
    expect((await uidsOf(t.db, t.inbox)).length).toBe(53)
  })

  it('starts the folder anew when the UIDs have run on so far that the messages in between would be a hole', async () => {
    const t = await setup()
    await saveMessages(t.db, t.inbox, [fetched(1), fetched(2)])
    const state = { uidValidity: 1n, uidNext: 2000, messages: [fetched(1999)] }
    const gone = server(state)
    await syncFolder(gone.session, t.db, t.inbox)
    expect(gone.asked).toEqual([`${2000 - NEWEST}:*`])
    expect(await uidsOf(t.db, t.inbox)).toEqual([1999])
  })
})

describe('older messages', () => {
  it('are not there to load for a folder that was not synced, and are there once the server has more than the phone', async () => {
    const t = await setup()
    expect(await hasOlder(t.db, t.inbox.id)).toBe(false)
    await syncFolder(server({ uidValidity: 1n, uidNext: 121, messages: many(1, 120) }).session, t.db, t.inbox)
    expect((await cachedBounds(t.db, t.inbox.id))?.count).toBe(NEWEST)
    expect(await hasOlder(t.db, t.inbox.id)).toBe(true)
  })

  it('are loaded a page at a time, the highest UIDs below the oldest the phone has, until there are none', async () => {
    const t = await setup()
    const state = { uidValidity: 1n, uidNext: 131, messages: many(1, 130) }
    const s = server(state)
    await syncFolder(s.session, t.db, t.inbox)
    expect(await uidsOf(t.db, t.inbox)).toEqual(many(81, 130).map((m) => m.uid))

    expect(await loadOlder(s.session, t.db, t.inbox)).toBe(PAGE)
    expect((await cachedBounds(t.db, t.inbox.id))?.min).toBe(31)
    expect(await hasOlder(t.db, t.inbox.id)).toBe(true)

    expect(await loadOlder(s.session, t.db, t.inbox)).toBe(30)
    expect((await cachedBounds(t.db, t.inbox.id))).toMatchObject({ min: 1, count: 130 })
    expect(await hasOlder(t.db, t.inbox.id)).toBe(false)

    expect(await loadOlder(s.session, t.db, t.inbox)).toBe(0)
  })

  it('come in full pages from a folder numbered with gaps, since the UIDs are taken from what the server has', async () => {
    const t = await setup()
    // 120 messages with every second number gone.
    const messages = Array.from({ length: 120 }, (_, i) => fetched((i + 1) * 2))
    const state = { uidValidity: 1n, uidNext: 241, messages }
    const s = server(state)
    await syncFolder(s.session, t.db, t.inbox)
    expect(await loadOlder(s.session, t.db, t.inbox)).toBe(PAGE)
    expect(s.fetchedByNumber.at(-1)).toHaveLength(PAGE)
  })

  it('are not asked for again when they are there already, and a message that was deleted meanwhile is not fetched', async () => {
    const t = await setup()
    const state = { uidValidity: 1n, uidNext: 111, messages: many(1, 110) }
    const s = server(state)
    await syncFolder(s.session, t.db, t.inbox)
    state.messages = state.messages.filter((m) => m.uid !== 60)
    await loadOlder(s.session, t.db, t.inbox)
    expect(s.fetchedByNumber.at(-1)).not.toContain(60)
    expect(await uidsOf(t.db, t.inbox)).not.toContain(60)
  })

  it('say that there are none when the server has no more than the phone has', async () => {
    const t = await setup()
    await syncFolder(server({ uidValidity: 1n, uidNext: 4, messages: many(1, 3) }).session, t.db, t.inbox)
    expect(await hasOlder(t.db, t.inbox.id)).toBe(false)
  })
})
