import { describe, expect, it } from 'vitest'
import type { FetchedMessage, ImapSession } from '@peregrine/core/imapSession'
import { enqueueAction, listPendingActions } from '@peregrine/core/pendingActionsStore'
import type { ComposeInput } from '@peregrine/core/types'
import { addAccount } from './accounts'
import { dropGone, knownUidValidity, rememberUidValidity, resetFolder, resetText } from './folderChanges'
import { syncFolders, type Folder } from './folders'
import { listMessages, saveMessages } from './messages'
import { syncFolder } from './sync'
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

/** A server with one folder, which says what its UIDVALIDITY and UIDNEXT are and gives what it has in the range it is asked for. */
function server(state: { uidValidity: bigint; uidNext: number; messages: FetchedMessage[] }) {
  const asked: string[] = []
  const session = {
    syncFetch: async (_path: string, decide: (s: { uidValidity: bigint; uidNext: number }) => string | Promise<string>) => {
      const range = await decide({ uidValidity: state.uidValidity, uidNext: state.uidNext })
      asked.push(range)
      const first = Number(range.split(':')[0])
      return { uidValidity: state.uidValidity, uidNext: state.uidNext, messages: state.messages.filter((m) => m.uid >= first) }
    }
  } as unknown as ImapSession
  return { session, asked }
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

describe('messages that the server no longer has', () => {
  it('are taken out of the list by the next sync: those in the range that was fetched that it did not give', async () => {
    const t = await setup()
    const state = { uidValidity: 1n, uidNext: 5, messages: [fetched(1), fetched(2), fetched(3), fetched(4)] }
    await syncFolder(server(state).session, t.db, t.inbox)
    expect(await uidsOf(t.db, t.inbox)).toEqual([1, 2, 3, 4])
    // 2 and 3 were deleted on another device.
    state.messages = [fetched(1), fetched(4)]
    await syncFolder(server(state).session, t.db, t.inbox)
    expect(await uidsOf(t.db, t.inbox)).toEqual([1, 4])
  })

  it('are taken out when the folder is empty now', async () => {
    const t = await setup()
    await syncFolder(server({ uidValidity: 1n, uidNext: 3, messages: [fetched(1), fetched(2)] }).session, t.db, t.inbox)
    await syncFolder(server({ uidValidity: 1n, uidNext: 3, messages: [] }).session, t.db, t.inbox)
    expect(await uidsOf(t.db, t.inbox)).toEqual([])
  })

  it('are not asked about when they are older than the range: what is not fetched is not known to be gone', async () => {
    const t = await setup()
    const messages = Array.from({ length: 60 }, (_, i) => fetched(i + 1))
    // 60 messages, UIDNEXT 61: the newest 50 are asked for, from UID 11.
    await syncFolder(server({ uidValidity: 1n, uidNext: 61, messages }).session, t.db, t.inbox)
    expect((await uidsOf(t.db, t.inbox))[0]).toBe(11)
    await saveMessages(t.db, t.inbox, [fetched(3)])
    await syncFolder(server({ uidValidity: 1n, uidNext: 61, messages }).session, t.db, t.inbox)
    expect(await uidsOf(t.db, t.inbox)).toContain(3)
  })

  it('are counted by dropGone, which leaves the others', async () => {
    const t = await setup()
    await saveMessages(t.db, t.inbox, [fetched(1), fetched(2), fetched(3)])
    expect(await dropGone(t.db, t.inbox.id, 2, [3])).toBe(1)
    expect(await uidsOf(t.db, t.inbox)).toEqual([1, 3])
  })
})
