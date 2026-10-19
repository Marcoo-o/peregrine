import type { WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImapSession } from '@peregrine/core/imapSession'
import type { ComposeInput } from '@peregrine/core/types'
import { IpcChannels } from '@shared/ipcContracts'
import { closeDb, openDb } from '../db/db'
import { insertAccount } from '../db/repositories/accountsRepo'
import { upsertFolder } from '../db/repositories/foldersRepo'
import { listMessagesPage, setPendingMove, upsertEnvelope } from '../db/repositories/messagesRepo'
import { enqueueAction, listPendingActions, pendingSummary } from '../db/repositories/pendingActionsRepo'
import type { BetterSqliteDb } from '../db/sqlDb'
import { OfflineQueue } from './OfflineQueue'

// The real implementation talks to the operating system's keychain through Electron.
vi.mock('../credentials/secureStore', () => ({
  encryptSecret: (plain: string): Buffer => Buffer.from(plain, 'utf8'),
  decryptSecret: (encrypted: Buffer): string => encrypted.toString('utf8')
}))

/**
 * The desktop's queue, run against a real database with every migration applied and the real
 * repositories, and a server that is a list of what it was asked. The rules themselves are tested
 * in `@peregrine/core`. What this checks is that the desktop hands the engine the right things:
 * that a folder id becomes the folder's path, that a failure ends up in the row, that a move
 * removes the local messages, that the window is told.
 */

let db: BetterSqliteDb

beforeEach(() => {
  db = openDb(':memory:', null)
})
afterEach(() => {
  closeDb()
  vi.useRealTimers()
})

async function account(): Promise<string> {
  return insertAccount(db, {
    displayName: 'a',
    emailAddress: 'a@example.com',
    imapHost: 'imap.example.com',
    imapPort: 993,
    imapSecure: 'tls',
    imapUsername: 'a',
    smtpHost: 'smtp.example.com',
    smtpPort: 465,
    smtpSecure: 'tls',
    smtpUsername: 'a'
  })
}

function folder(accountId: string, path: string): Promise<string> {
  return upsertFolder(db, {
    accountId,
    imapPath: path,
    displayName: path,
    specialUse: path === 'INBOX' ? 'inbox' : null,
    parentId: null,
    uidValidity: 1,
    uidNext: 1
  })
}

function message(accountId: string, folderId: string, uid: number) {
  return upsertEnvelope(db, {
    accountId,
    folderId,
    uid,
    messageIdHeader: `<${uid}@example.com>`,
    inReplyTo: null,
    referencesHeader: null,
    subject: `Subject ${uid}`,
    fromName: 'Sender',
    fromAddress: 'sender@example.com',
    to: [],
    cc: [],
    bcc: [],
    date: new Date(2026, 0, uid).toISOString(),
    isRead: false,
    isFlagged: false,
    hasAttachments: false,
    previewText: '',
    sizeBytes: 100,
    flags: []
  })
}

function server() {
  const asked: string[] = []
  const behaviour: { moveFails?: string } = {}
  const imap = {
    addFlags: async (path: string, uid: number, flags: string[]) => {
      asked.push(`add ${path} ${uid} ${flags.join(',')}`)
    },
    removeFlags: async (path: string, uid: number, flags: string[]) => {
      asked.push(`remove ${path} ${uid} ${flags.join(',')}`)
    },
    moveMessages: async (from: string, to: string, uids: number[]) => {
      if (behaviour.moveFails) throw new Error(behaviour.moveFails)
      asked.push(`move ${from} > ${to} ${uids.join(',')}`)
      return null
    },
    deleteMessages: async (path: string, uids: number[]) => {
      asked.push(`delete ${path} ${uids.join(',')}`)
    }
  } as unknown as ImapSession
  return { imap, asked, behaviour }
}

const quiet = () => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
}

describe('the desktop queue, against the real database', () => {
  it('replays flags with the path of the folder, and takes the rows off the queue', async () => {
    const a = await account()
    const inbox = await folder(a, 'INBOX')
    await enqueueAction(db, a, 'flags', { folderId: inbox, uids: [1, 2], add: ['\\Seen'], remove: ['\\Flagged'] })
    const s = server()

    await new OfflineQueue(db, () => undefined).flush(a, s.imap)

    expect(s.asked).toEqual(['add INBOX 1 \\Seen', 'remove INBOX 1 \\Flagged', 'add INBOX 2 \\Seen', 'remove INBOX 2 \\Flagged'])
    expect(await listPendingActions(db, a)).toEqual([])
  })

  it('replays a move on the server, then removes the messages that left from the local folder', async () => {
    const a = await account()
    const inbox = await folder(a, 'INBOX')
    const archive = await folder(a, 'Archive')
    await message(a, inbox, 1)
    await message(a, inbox, 2)
    await setPendingMove(db, inbox, [1], archive)
    await enqueueAction(db, a, 'move', { sourceFolderId: inbox, targetFolderId: archive, uids: [1] })
    const s = server()

    await new OfflineQueue(db, () => undefined).flush(a, s.imap)

    expect(s.asked).toEqual(['move INBOX > Archive 1'])
    const left = await listMessagesPage(db, [inbox], undefined, 10)
    expect(left.items.map((item) => item.uid)).toEqual([2])
    expect(await listPendingActions(db, a)).toEqual([])
  })

  it('keeps the messages and the mark when the server refuses a move, and records why in the row', async () => {
    quiet()
    const a = await account()
    const inbox = await folder(a, 'INBOX')
    const archive = await folder(a, 'Archive')
    await message(a, inbox, 1)
    await setPendingMove(db, inbox, [1], archive)
    await enqueueAction(db, a, 'move', { sourceFolderId: inbox, targetFolderId: archive, uids: [1] })
    await enqueueAction(db, a, 'delete', { folderId: inbox, uids: [9] })
    const s = server()
    s.behaviour.moveFails = 'NO [CANNOT] mailbox is read-only'

    await new OfflineQueue(db, () => undefined).flush(a, s.imap)

    const left = await listMessagesPage(db, [inbox], undefined, 10)
    expect(left.items.map((item) => item.uid)).toEqual([1])
    expect(left.items[0].pendingMoveTo).toBe(archive)
    const rows = await listPendingActions(db, a)
    // both still there: the failed one with its reason and a count, the one behind it untouched
    expect(rows.map((row) => row.kind)).toEqual(['move', 'delete'])
    expect(rows[0].attempts).toBe(1)
    expect(rows[0].lastError).toBe('NO [CANNOT] mailbox is read-only')
    expect(rows[1].attempts).toBe(0)
    expect(s.asked).toEqual([])
  })

  it('drops a move whose target folder is gone and takes the mark off the messages', async () => {
    quiet()
    const a = await account()
    const inbox = await folder(a, 'INBOX')
    await message(a, inbox, 1)
    await setPendingMove(db, inbox, [1], 'folder-that-was-deleted')
    await enqueueAction(db, a, 'move', { sourceFolderId: inbox, targetFolderId: 'folder-that-was-deleted', uids: [1] })
    const s = server()

    await new OfflineQueue(db, () => undefined).flush(a, s.imap)

    expect(s.asked).toEqual([])
    expect(await listPendingActions(db, a)).toEqual([])
    const left = await listMessagesPage(db, [inbox], undefined, 10)
    expect(left.items[0].pendingMoveTo).toBeNull()
  })

  it('deletes on the server', async () => {
    const a = await account()
    const trash = await folder(a, 'Trash')
    await enqueueAction(db, a, 'delete', { folderId: trash, uids: [4, 5] })
    const s = server()

    await new OfflineQueue(db, () => undefined).flush(a, s.imap)

    expect(s.asked).toEqual(['delete Trash 4,5'])
  })

  it('sends a queued message through the handler, marked to go now, and keeps it when that fails', async () => {
    quiet()
    const a = await account()
    const input = { subject: 'Hello' } as ComposeInput
    await enqueueAction(db, a, 'send', { input })
    const queue = new OfflineQueue(db, () => undefined)
    const sent: ComposeInput[] = []
    queue.setSendHandler(async () => {
      throw new Error('connection refused')
    })
    await queue.flush(a, server().imap)
    expect((await listPendingActions(db, a))[0].lastError).toBe('connection refused')

    queue.setSendHandler(async (i) => void sent.push(i))
    await queue.flush(a, server().imap)
    expect(sent).toEqual([{ subject: 'Hello', sendNow: true }])
    expect(await listPendingActions(db, a)).toEqual([])
  })

  it('tells the window what is waiting, after a run, and does not mind there being no window', async () => {
    quiet()
    const a = await account()
    const inbox = await folder(a, 'INBOX')
    await enqueueAction(db, a, 'move', { sourceFolderId: inbox, targetFolderId: 'gone', uids: [1] })
    const send = vi.fn()
    const window = { send } as unknown as WebContents
    const s = server()

    await new OfflineQueue(db, () => window).flush(a, s.imap)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(IpcChannels.pendingActions, await pendingSummary(db))
    expect(send.mock.calls[0][1]).toMatchObject({ total: 0 })

    await expect(new OfflineQueue(db, () => undefined).flush(a, s.imap)).resolves.toBeUndefined()
  })

  it('arms the timer for a scheduled message and runs the queue when it is due', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const a = await account()
    await enqueueAction(db, a, 'send', { input: { subject: 'Monday' } as ComposeInput }, Date.now() + 60_000)
    const queue = new OfflineQueue(db, () => undefined)
    const run = vi.fn()

    await queue.rescheduleDue(run)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(31_500)
    expect(run).toHaveBeenCalledTimes(1)

    queue.stop()
  })
})
