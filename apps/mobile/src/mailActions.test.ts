import { describe, expect, it } from 'vitest'
import type { FetchedMessage, ImapSession, MailboxEntry } from '@peregrine/core/imapSession'
import { listPendingActions } from '@peregrine/core/pendingActionsStore'
import type { ComposeInput } from '@peregrine/core/types'
import { addAccount, type NewAccount } from './accounts'
import { syncFolders, type Folder } from './folders'
import { MailActions } from './mailActions'
import { changeFlags, listMessages, saveMessages } from './messages'
import { createQueue } from './queue'
import { migratedDatabase } from './testing/testDb'

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

const entry = (path: string, specialUse: string | null = null): MailboxEntry => ({ path, name: path, parentPath: null, flags: [], specialUse })
const fetched = (uid: number, flags: string[] = []): FetchedMessage => ({
  uid,
  flags,
  size: 10,
  hasAttachment: false,
  envelope: { subject: `s${uid}`, date: new Date(1000 + uid), from: [{ address: 'a@example.net' }] }
})

const compose = (accountId: string): ComposeInput => ({
  accountId,
  to: [{ name: '', address: 'anna@example.net' }],
  cc: [],
  bcc: [],
  subject: 'Hello',
  textBody: 'Hi',
  htmlBody: '',
  attachments: []
})

let counter = 0
const ids = () => `f${++counter}`

async function setup(options: { trash?: boolean } = {}) {
  const made = await migratedDatabase()
  const account = await addAccount(made.db, newAccount())
  const entries = [entry('INBOX', '\\Inbox'), entry('Archive', '\\Archive'), entry('Other')]
  if (options.trash !== false) entries.push(entry('Trash', '\\Trash'))
  const folders = await syncFolders(made.db, account.id, entries, ids)
  const byPath = (path: string) => folders.find((f) => f.imapPath === path) as Folder

  const server = { asked: [] as string[], fail: null as string | null, gate: null as Promise<void> | null }
  const imap = {
    addFlags: async (path: string, uid: number, f: string[]) => {
      if (server.gate) await server.gate
      if (server.fail) throw new Error(server.fail)
      server.asked.push(`add ${path} ${uid} ${f.join(',')}`)
    },
    removeFlags: async (path: string, uid: number, f: string[]) => {
      if (server.fail) throw new Error(server.fail)
      server.asked.push(`remove ${path} ${uid} ${f.join(',')}`)
    },
    moveMessages: async (from: string, to: string, uids: number[]) => {
      if (server.fail) throw new Error(server.fail)
      server.asked.push(`move ${from} > ${to} ${uids.join(',')}`)
      return null
    },
    deleteMessages: async (path: string, uids: number[]) => {
      if (server.fail) throw new Error(server.fail)
      server.asked.push(`delete ${path} ${uids.join(',')}`)
    }
  } as unknown as ImapSession

  const state = { connected: true }
  const logs: string[] = []
  const sent: ComposeInput[] = []
  const queue = createQueue(made.db, {
    changed: async () => undefined,
    log: { warn: (m) => logs.push(m), error: (m) => logs.push(m) }
  })
  queue.setSendHandler(async (input) => void sent.push(input))
  const actions = new MailActions({
    db: made.db,
    queue,
    session: () => (state.connected ? imap : null),
    log: { error: (m) => logs.push(m) }
  })
  return { ...made, account, byPath, server, state, logs, sent, actions, queue }
}

describe('changing flags', () => {
  it('adds and removes without regard to case, and never twice', () => {
    expect(changeFlags(['\\Seen'], ['\\seen', '\\Flagged'], [])).toEqual(['\\Seen', '\\Flagged'])
    expect(changeFlags(['\\Seen', '\\Flagged'], [], ['\\FLAGGED'])).toEqual(['\\Seen'])
    // asked to add and remove the same flag, it is removed: the later decision of a toggle wins
    expect(changeFlags(['a'], ['b'], ['b'])).toEqual(['a'])
    expect(changeFlags([], [], [])).toEqual([])
  })
})

describe('with a connection', () => {
  it('marks messages read here and on the server, and nothing is left waiting', async () => {
    const t = await setup()
    const inbox = t.byPath('INBOX')
    await saveMessages(t.db, inbox, [fetched(1), fetched(2)])

    await t.actions.setFlags(inbox, [1, 2], ['\\Seen'], [])

    expect((await listMessages(t.db, inbox.id)).map((m) => m.flags)).toEqual([['\\Seen'], ['\\Seen']])
    expect(t.server.asked).toEqual(['add INBOX 1 \\Seen', 'add INBOX 2 \\Seen'])
    expect((await t.actions.waiting()).total).toBe(0)
  })

  it('moves messages, which leave the source folder once the server has them', async () => {
    const t = await setup()
    const inbox = t.byPath('INBOX')
    await saveMessages(t.db, inbox, [fetched(1), fetched(2)])

    await t.actions.move(inbox, [1], t.byPath('Archive'))

    expect(t.server.asked).toEqual(['move INBOX > Archive 1'])
    expect((await listMessages(t.db, inbox.id)).map((m) => m.uid)).toEqual([2])
  })

  it('deletes into the trash folder when the account has one', async () => {
    const t = await setup()
    const inbox = t.byPath('INBOX')
    await saveMessages(t.db, inbox, [fetched(1)])
    await t.actions.remove(inbox, [1])
    expect(t.server.asked).toEqual(['move INBOX > Trash 1'])
  })

  it('deletes for good from the trash itself, when asked to, and when there is no trash', async () => {
    const t = await setup()
    const trash = t.byPath('Trash')
    const inbox = t.byPath('INBOX')
    await saveMessages(t.db, trash, [fetched(1)])
    await saveMessages(t.db, inbox, [fetched(2)])

    await t.actions.remove(trash, [1])
    await t.actions.remove(inbox, [2], { permanent: true })
    expect(t.server.asked).toEqual(['delete Trash 1', 'delete INBOX 2'])
    expect(await listMessages(t.db, trash.id)).toEqual([])
    expect(await listMessages(t.db, inbox.id)).toEqual([])

    const bare = await setup({ trash: false })
    await saveMessages(bare.db, bare.byPath('INBOX'), [fetched(3)])
    await bare.actions.remove(bare.byPath('INBOX'), [3])
    expect(bare.server.asked).toEqual(['delete INBOX 3'])
  })

  it('sends through the handler the queue was given, as one that is to go now', async () => {
    const t = await setup()
    await t.actions.send(compose(t.account.id))
    expect(t.sent).toHaveLength(1)
    expect(t.sent[0]).toMatchObject({ subject: 'Hello', sendNow: true })
    expect((await t.actions.waiting()).total).toBe(0)
  })

  it('keeps the order of two decisions made at once, though the first is slow', async () => {
    const t = await setup()
    const inbox = t.byPath('INBOX')
    await saveMessages(t.db, inbox, [fetched(1), fetched(2)])
    let open!: () => void
    t.server.gate = new Promise<void>((resolve) => (open = resolve))

    const first = t.actions.setFlags(inbox, [1], ['\\Seen'], [])
    // the queue is running the first and is stuck in it when the second is decided
    await new Promise((resolve) => setTimeout(resolve, 10))
    const second = t.actions.setFlags(inbox, [2], ['\\Flagged'], [])
    open()
    await Promise.all([first, second])

    expect(t.server.asked).toEqual(['add INBOX 1 \\Seen', 'add INBOX 2 \\Flagged'])
    expect((await t.actions.waiting()).total).toBe(0)
  })

  it('does nothing for no messages, no change, another account’s folder or the same folder', async () => {
    const t = await setup()
    const inbox = t.byPath('INBOX')
    const other = await addAccount(t.db, newAccount({ displayName: 'B' }))
    const [foreign] = await syncFolders(t.db, other.id, [entry('INBOX')], ids)
    await saveMessages(t.db, inbox, [fetched(1)])

    await t.actions.setFlags(inbox, [], ['\\Seen'], [])
    await t.actions.setFlags(inbox, [1], [], [])
    await t.actions.move(inbox, [1], inbox)
    await t.actions.move(inbox, [1], foreign)
    await t.actions.move(inbox, [], t.byPath('Archive'))
    await t.actions.remove(inbox, [])

    expect(await listPendingActions(t.db, t.account.id)).toEqual([])
    expect(t.server.asked).toEqual([])
  })
})

describe('without a connection', () => {
  it('shows what was decided at once and tells the server later, in the order it was decided', async () => {
    const t = await setup()
    t.state.connected = false
    const inbox = t.byPath('INBOX')
    await saveMessages(t.db, inbox, [fetched(1), fetched(2), fetched(3)])

    await t.actions.setFlags(inbox, [1], ['\\Seen'], [])
    await t.actions.move(inbox, [2], t.byPath('Archive'))
    await t.actions.remove(inbox, [3], { permanent: true })

    const list = await listMessages(t.db, inbox.id)
    // 1 is read, 2 is shown where it is with where it is going, 3 is gone
    expect(list.map((m) => [m.uid, m.flags, m.pendingMoveTo])).toEqual([
      [2, [], t.byPath('Archive').id],
      [1, ['\\Seen'], null]
    ])
    expect(t.server.asked).toEqual([])
    expect(await t.actions.waiting()).toMatchObject({ total: 3, byKind: { flags: 1, move: 1, delete: 1 } })

    t.state.connected = true
    await t.actions.flush(t.account.id)

    expect(t.server.asked).toEqual(['add INBOX 1 \\Seen', 'move INBOX > Archive 2', 'delete INBOX 3'])
    expect((await t.actions.waiting()).total).toBe(0)
    expect((await listMessages(t.db, inbox.id)).map((m) => m.uid)).toEqual([1])
  })

  it('replaces a move that waits for a message when it is moved again, and keeps the mark of the last', async () => {
    const t = await setup()
    t.state.connected = false
    const inbox = t.byPath('INBOX')
    await saveMessages(t.db, inbox, [fetched(1), fetched(2)])

    await t.actions.move(inbox, [1, 2], t.byPath('Archive'))
    await t.actions.move(inbox, [1], t.byPath('Other'))

    const waiting = await listPendingActions(t.db, t.account.id)
    expect(waiting.map((a) => a.payload)).toEqual([
      { sourceFolderId: inbox.id, targetFolderId: t.byPath('Archive').id, uids: [2] },
      { sourceFolderId: inbox.id, targetFolderId: t.byPath('Other').id, uids: [1] }
    ])
    expect((await listMessages(t.db, inbox.id)).map((m) => [m.uid, m.pendingMoveTo])).toEqual([
      [2, t.byPath('Archive').id],
      [1, t.byPath('Other').id]
    ])
  })

  it('lets a deletion settle the move that waited for the same message', async () => {
    const t = await setup({ trash: false })
    t.state.connected = false
    const inbox = t.byPath('INBOX')
    await saveMessages(t.db, inbox, [fetched(1)])

    await t.actions.move(inbox, [1], t.byPath('Archive'))
    await t.actions.remove(inbox, [1])

    expect((await listPendingActions(t.db, t.account.id)).map((a) => a.kind)).toEqual(['delete'])
  })

  it('keeps a message to be sent until there is a connection', async () => {
    const t = await setup()
    t.state.connected = false
    await t.actions.send(compose(t.account.id))
    expect(t.sent).toEqual([])
    expect((await t.actions.waiting()).byKind.send).toBe(1)

    t.state.connected = true
    await t.actions.flush(t.account.id)
    expect(t.sent).toHaveLength(1)
    expect((await t.actions.waiting()).total).toBe(0)
  })
})

describe('when the server refuses', () => {
  it('keeps the action with the reason, and the local change stands', async () => {
    const t = await setup()
    const inbox = t.byPath('INBOX')
    await saveMessages(t.db, inbox, [fetched(1)])
    t.server.fail = 'NO [CANNOT] not allowed'

    await t.actions.setFlags(inbox, [1], ['\\Seen'], [])

    expect((await listMessages(t.db, inbox.id))[0].flags).toEqual(['\\Seen'])
    const [action] = await listPendingActions(t.db, t.account.id)
    expect(action).toMatchObject({ kind: 'flags', attempts: 1, lastError: 'NO [CANNOT] not allowed' })
  })

  it('gives up on what was given up on when the user says so, and the moved messages are shown again', async () => {
    const t = await setup()
    const inbox = t.byPath('INBOX')
    await saveMessages(t.db, inbox, [fetched(1)])
    t.server.fail = 'NO'
    await t.actions.move(inbox, [1], t.byPath('Archive'))
    for (let i = 0; i < 4; i++) await t.actions.flush(t.account.id)
    expect((await t.actions.waiting()).failed).toBe(1)

    await t.actions.discardFailed()

    expect((await t.actions.waiting()).failed).toBe(0)
    expect((await listMessages(t.db, inbox.id))[0].pendingMoveTo).toBeNull()
  })
})
