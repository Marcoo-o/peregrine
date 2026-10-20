import type { FetchedMessage } from '@peregrine/core/imapSession'
import type { SqlDb } from '@peregrine/core/sqlDb'
import { SEEN } from './flags'

export interface StoredMessage {
  uid: number
  subject: string
  sender: string
  dateMs: number | null
  flags: string[]
  size: number
  hasAttachment: boolean
  /** The id of the folder it is waiting to be moved to, or null. */
  pendingMoveTo: string | null
}

/** How many numbers go into one statement. SQLite allows far more, and a short list is easier to read in a log. */
const CHUNK = 500

function sender(message: FetchedMessage): string {
  const from = message.envelope.from?.[0]
  if (!from) return ''
  return from.name ? `${from.name} <${from.address ?? ''}>` : (from.address ?? '')
}

/**
 * Stores what a sync fetched. A message that is already there is updated and not replaced, so that
 * the mark that says a move is queued for it survives: replacing the row would clear it, and the
 * message would show up in the folder it is leaving until the queue next ran.
 */
export async function saveMessages(
  db: SqlDb,
  folder: { id: string; accountId: string },
  messages: FetchedMessage[]
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const message of messages) {
      await tx.run(
        `INSERT INTO messages
           (folder_id, uid, account_id, subject, sender, date_ms, flags, size, has_attachment)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (folder_id, uid) DO UPDATE SET
           subject = excluded.subject, sender = excluded.sender, date_ms = excluded.date_ms,
           flags = excluded.flags, size = excluded.size, has_attachment = excluded.has_attachment`,
        folder.id,
        message.uid,
        folder.accountId,
        message.envelope.subject ?? '',
        sender(message),
        message.envelope.date ? message.envelope.date.getTime() : null,
        JSON.stringify(message.flags),
        message.size,
        message.hasAttachment ? 1 : 0
      )
    }
  })
}

interface MessageRow {
  uid: number
  subject: string
  sender: string
  date_ms: number | null
  flags: string
  size: number
  has_attachment: number
  pending_move_to: string | null
}

export function toStoredMessage(row: MessageRow): StoredMessage {
  return {
    uid: row.uid,
    subject: row.subject,
    sender: row.sender,
    dateMs: row.date_ms,
    flags: JSON.parse(row.flags) as string[],
    size: row.size,
    hasAttachment: row.has_attachment === 1,
    pendingMoveTo: row.pending_move_to
  }
}

/** The newest messages of a folder first. */
export async function listMessages(db: SqlDb, folderId: string): Promise<StoredMessage[]> {
  const rows = await db.all<MessageRow>(
    `SELECT uid, subject, sender, date_ms, flags, size, has_attachment, pending_move_to FROM messages
     WHERE folder_id = ? ORDER BY uid DESC`,
    folderId
  )
  return rows.map(toStoredMessage)
}

/** Marks messages as waiting to be moved to a folder, or takes the mark off with null. */
export async function setPendingMove(
  db: SqlDb,
  folderId: string,
  uids: number[],
  targetFolderId: string | null
): Promise<void> {
  for (let at = 0; at < uids.length; at += CHUNK) {
    const part = uids.slice(at, at + CHUNK)
    await db.run(
      `UPDATE messages SET pending_move_to = ? WHERE folder_id = ? AND uid IN (${part.map(() => '?').join(',')})`,
      targetFolderId,
      folderId,
      ...part
    )
  }
}

/** Takes messages out of a folder here. The server is not asked: this is for what it no longer has. */
export async function deleteMessages(db: SqlDb, folderId: string, uids: number[]): Promise<void> {
  for (let at = 0; at < uids.length; at += CHUNK) {
    const part = uids.slice(at, at + CHUNK)
    await db.run(
      `DELETE FROM messages WHERE folder_id = ? AND uid IN (${part.map(() => '?').join(',')})`,
      folderId,
      ...part
    )
  }
}

/**
 * The flags after adding and removing some. IMAP compares flags without regard to case, so `\seen`
 * and `\Seen` are one flag: a flag that is there in another spelling is not added a second time, and
 * is removed whichever way it is spelled.
 */
export function changeFlags(current: string[], add: string[], remove: string[]): string[] {
  const gone = new Set(remove.map((flag) => flag.toLowerCase()))
  const next = current.filter((flag) => !gone.has(flag.toLowerCase()))
  for (const flag of add) {
    if (gone.has(flag.toLowerCase())) continue
    if (!next.some((have) => have.toLowerCase() === flag.toLowerCase())) next.push(flag)
  }
  return next
}

/** Changes the flags of messages here. The server is told by the queue, not by this. */
export async function applyFlags(
  db: SqlDb,
  folderId: string,
  uids: number[],
  add: string[],
  remove: string[]
): Promise<void> {
  await db.transaction(async (tx) => {
    for (let at = 0; at < uids.length; at += CHUNK) {
      const part = uids.slice(at, at + CHUNK)
      const rows = await tx.all<{ uid: number; flags: string }>(
        `SELECT uid, flags FROM messages WHERE folder_id = ? AND uid IN (${part.map(() => '?').join(',')})`,
        folderId,
        ...part
      )
      for (const row of rows) {
        const before = JSON.parse(row.flags) as string[]
        const after = changeFlags(before, add, remove)
        if (after.length === before.length && after.every((flag, i) => flag === before[i])) continue
        await tx.run('UPDATE messages SET flags = ? WHERE folder_id = ? AND uid = ?', JSON.stringify(after), folderId, row.uid)
      }
    }
  })
}

/**
 * How many messages of each folder of an account have not been read, by the id of the folder. A folder with
 * none is not in the result. The flags are compared without regard to case, as IMAP does.
 */
export async function unreadCounts(db: SqlDb, accountId: string): Promise<Record<string, number>> {
  const rows = await db.all<{ folder_id: string; unread: number }>(
    `SELECT folder_id, COUNT(*) AS unread FROM messages
     WHERE account_id = ?
       AND NOT EXISTS (SELECT 1 FROM json_each(messages.flags) WHERE lower(json_each.value) = lower(?))
     GROUP BY folder_id`,
    accountId,
    SEEN
  )
  return Object.fromEntries(rows.map((row) => [row.folder_id, row.unread]))
}
