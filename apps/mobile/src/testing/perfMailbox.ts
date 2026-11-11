import type { SqlDb } from '@peregrine/core/sqlDb'
import { addAccount } from '../accounts'
import { syncFolders } from '../folders'
import { account } from './appHarness'
import { migratedDatabase } from './testDb'

/** A small deterministic generator, so that two runs make the same mailbox. */
function random(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

async function fill(db: SqlDb, folderId: string, accountId: string, count: number, rand: () => number, senders: string[]): Promise<void> {
  const columns = '(folder_id, uid, account_id, subject, sender, date_ms, flags, size, has_attachment, body_text, preview_text, message_id)'
  const PER = 400
  await db.transaction(async (tx) => {
    for (let start = 0; start < count; start += PER) {
      const rows = Math.min(PER, count - start)
      const params: unknown[] = []
      for (let i = 0; i < rows; i++) {
        const uid = 1 + start + i
        const person = senders[Math.floor(rand() * senders.length)]
        const unread = rand() < 0.14
        const text = rand() < 0.33 ? `Hello, this is message ${uid} about the project and the budget for next quarter. `.repeat(4) : null
        params.push(
          folderId,
          uid,
          accountId,
          `Subject number ${uid} about the quarterly planning`,
          person,
          1_700_000_000_000 + uid * 60_000,
          unread ? '[]' : '["\\\\Seen"]',
          2000 + Math.floor(rand() * 50_000),
          rand() < 0.1 ? 1 : 0,
          text,
          text ? text.slice(0, 120) : null,
          `<m${uid}.${folderId}@mail.test>`
        )
      }
      await tx.run(`INSERT INTO messages ${columns} VALUES ${Array.from({ length: rows }, () => '(?,?,?,?,?,?,?,?,?,?,?,?)').join(',')}`, ...(params as never[]))
    }
  })
}

export interface BuiltMailbox {
  db: SqlDb
  accounts: Array<{ id: string }>
  folders: Array<{ id: string; accountId: string; path: string }>
  /** The inbox of the first account. */
  inbox: { id: string; accountId: string; path: string }
  madeInMs: number
}

/**
 * A mailbox of that many messages for measuring, the same one every time: two accounts (inboxes, an archive, and sent mail for the first), about a seventh
 * of the messages unread, a text for a third of them, and a twentieth as many senders as there are messages.
 */
export async function buildMailbox(total: number): Promise<BuiltMailbox> {
  const start = Date.now()
  const { db } = await migratedDatabase()
  const rand = random(7)
  const senders = Array.from({ length: Math.max(500, Math.floor(total / 20)) }, (_v, i) => `Person ${i} <person${i}@northwind${i % 40}.test>`)

  const accounts = [await addAccount(db, account('a'), { now: 1 }), await addAccount(db, account('b'), { now: 2 })]
  const layout = [
    { acc: 0, path: 'INBOX', share: 0.3 },
    { acc: 0, path: 'Archive', share: 0.4 },
    { acc: 0, path: 'Sent', share: 0.05 },
    { acc: 1, path: 'INBOX', share: 0.2 },
    { acc: 1, path: 'Archive', share: 0.05 }
  ]
  const specialUse: Record<string, string | null> = { INBOX: null, Archive: '\\Archive', Sent: '\\Sent' }
  const folders: BuiltMailbox['folders'] = []
  for (const [index, entry] of accounts.entries()) {
    const mine = layout.filter((row) => row.acc === index)
    const stored = await syncFolders(
      db,
      entry.id,
      mine.map((row) => ({ path: row.path, name: row.path, parentPath: null, flags: [], specialUse: specialUse[row.path] ?? null }))
    )
    for (const folder of stored) folders.push({ id: folder.id, accountId: entry.id, path: folder.imapPath })
  }
  for (const row of layout) {
    const folder = folders.find((candidate) => candidate.accountId === accounts[row.acc].id && candidate.path === row.path)!
    await fill(db, folder.id, folder.accountId, Math.round(total * row.share), rand, senders)
  }
  const inbox = folders.find((folder) => folder.accountId === accounts[0].id && folder.path === 'INBOX')!
  return { db, accounts, folders, inbox, madeInMs: Date.now() - start }
}

/** The middle one of a few runs of the same thing, in milliseconds, and what the last run gave. */
export async function timed<T>(work: () => Promise<T>, runs = 3): Promise<{ ms: number; result: T }> {
  const times: number[] = []
  let result: T | undefined
  for (let i = 0; i < runs; i++) {
    const start = Date.now()
    result = await work()
    times.push(Date.now() - start)
  }
  times.sort((a, b) => a - b)
  return { ms: times[Math.floor(times.length / 2)], result: result as T }
}
