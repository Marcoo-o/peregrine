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
  /** The first of its text, flattened to a line or two, or empty while the text has not been fetched. */
  preview: string
  /** When it comes back, if it was put aside, which is only a moment ahead for a message that is still away. */
  snoozedUntil: number | null
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
  preview_text: string | null
  snoozed_until?: number | null
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
    pendingMoveTo: row.pending_move_to,
    preview: row.preview_text ?? '',
    snoozedUntil: row.snoozed_until ?? null
  }
}

/** The columns of a message that a list of one folder reads. */
const COLUMNS = 'uid, subject, sender, date_ms, flags, size, has_attachment, pending_move_to, preview_text, snoozed_until'

/**
 * The newest messages of a folder first, without those that are put aside: they are not in the folder until their
 * moment, and a moment that has passed is no snooze at all, which is why nothing has to be cleared when it comes.
 */
export async function listMessages(db: SqlDb, folderId: string, now: number = Date.now()): Promise<StoredMessage[]> {
  const rows = await db.all<MessageRow>(
    `SELECT ${COLUMNS} FROM messages
     WHERE folder_id = ? AND (snoozed_until IS NULL OR snoozed_until <= ?) ORDER BY uid DESC`,
    folderId,
    now
  )
  return rows.map(toStoredMessage)
}

/** One message of a folder by its UID, whether it is put aside or not: what is done to a message that is open has to find it. */
export async function getMessage(db: SqlDb, folderId: string, uid: number): Promise<StoredMessage | undefined> {
  const row = await db.get<MessageRow>(`SELECT ${COLUMNS} FROM messages WHERE folder_id = ? AND uid = ?`, folderId, uid)
  return row ? toStoredMessage(row) : undefined
}

/**
 * Puts messages aside until a moment, or brings them back with null. Only the phone knows: nothing is written to the
 * server, and the message stays where it is on the other devices, as it does with the desktop's.
 */
export async function snoozeMessages(
  db: SqlDb,
  refs: ReadonlyArray<{ folderId: string; uid: number }>,
  until: number | null
): Promise<void> {
  for (const ref of refs) {
    await db.run('UPDATE messages SET snoozed_until = ? WHERE folder_id = ? AND uid = ?', until, ref.folderId, ref.uid)
  }
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
export async function unreadCounts(db: SqlDb, accountId: string, now: number = Date.now()): Promise<Record<string, number>> {
  const rows = await db.all<{ folder_id: string; unread: number }>(
    `SELECT folder_id, COUNT(*) AS unread FROM messages
     WHERE account_id = ? AND (snoozed_until IS NULL OR snoozed_until <= ?)
       AND NOT EXISTS (SELECT 1 FROM json_each(messages.flags) WHERE lower(json_each.value) = lower(?))
     GROUP BY folder_id`,
    accountId,
    now,
    SEEN
  )
  return Object.fromEntries(rows.map((row) => [row.folder_id, row.unread]))
}
