import type { SqlDb } from '@peregrine/core/sqlDb'
import { SEEN } from '../flags'
import { toStoredMessage } from '../messages'

/** A message that arrived in an inbox while nobody was looking at it. */
export interface NewMessage {
  accountId: string
  accountName: string
  folderId: string
  uid: number
  /** The sender as it was written, `Anna <anna@example.net>` or only an address. */
  sender: string
  subject: string
}

/** Which folders are inboxes: the server says so, or it is called INBOX, which every server has. */
const IS_INBOX = `(f.special_use = '\\Inbox' OR upper(f.imap_path) = 'INBOX')`

/**
 * What is known of every inbox before it is brought up to date: its highest UID, and 0 for one with no
 * message in it. What arrives afterwards is new, and what was there is not, however the user came to see it.
 * A folder that is not in the map was not known at all, and nothing in it is called new: there is nothing to
 * compare it with, and a notification for every message of a mailbox that was just added would be a flood.
 */
export async function inboxBaselines(db: SqlDb): Promise<Map<string, number>> {
  const rows = await db.all<{ folder_id: string; highest: number }>(
    `SELECT f.id AS folder_id, COALESCE(MAX(m.uid), 0) AS highest
     FROM folders f LEFT JOIN messages m ON m.folder_id = f.id
     WHERE ${IS_INBOX}
     GROUP BY f.id`
  )
  return new Map(rows.map((row) => [row.folder_id, row.highest]))
}

/**
 * The messages that came into the inboxes after the baselines were taken and are not read: a higher UID
 * than the inbox had, and without the read flag. A message that was read on the server, by another client,
 * before it was fetched is not news to anybody.
 */
export async function newMessagesSince(db: SqlDb, baselines: Map<string, number>): Promise<NewMessage[]> {
  const rows = await db.all<
    Parameters<typeof toStoredMessage>[0] & { account_id: string; folder_id: string; account_name: string }
  >(
    `SELECT m.uid, m.subject, m.sender, m.date_ms, m.flags, m.size, m.has_attachment, m.pending_move_to,
            m.account_id, m.folder_id, a.display_name AS account_name
     FROM messages m
     JOIN folders f ON f.id = m.folder_id
     JOIN accounts a ON a.id = m.account_id
     WHERE ${IS_INBOX}
     ORDER BY a.created_at, a.id, m.folder_id, m.uid`
  )
  return rows
    .filter((row) => {
      const baseline = baselines.get(row.folder_id)
      return baseline !== undefined && row.uid > baseline && !toStoredMessage(row).flags.includes(SEEN)
    })
    .map((row) => ({
      accountId: row.account_id,
      accountName: row.account_name,
      folderId: row.folder_id,
      uid: row.uid,
      sender: row.sender,
      subject: row.subject
    }))
}

/**
 * The messages that were put aside and whose moment has come, which nobody has been told of yet: a moment that has passed
 * and has not been taken off. A message that came back while the application was open is among them, and is announced all
 * the same, since the moment is what is looked at and not who saw the message.
 */
export async function dueSnoozed(db: SqlDb, now: number): Promise<NewMessage[]> {
  const rows = await db.all<{
    uid: number
    subject: string
    sender: string
    account_id: string
    folder_id: string
    account_name: string
  }>(
    `SELECT m.uid, m.subject, m.sender, m.account_id, m.folder_id, a.display_name AS account_name
     FROM messages m
     JOIN accounts a ON a.id = m.account_id
     WHERE m.snoozed_until IS NOT NULL AND m.snoozed_until <= ?
     ORDER BY a.created_at, a.id, m.folder_id, m.uid`,
    now
  )
  return rows.map((row) => ({
    accountId: row.account_id,
    accountName: row.account_name,
    folderId: row.folder_id,
    uid: row.uid,
    sender: row.sender,
    subject: row.subject
  }))
}

/** Takes the moment off messages that were announced, which is what keeps them from being announced again. */
export async function clearSnoozed(db: SqlDb, messages: readonly NewMessage[]): Promise<void> {
  for (const message of messages) {
    await db.run('UPDATE messages SET snoozed_until = NULL WHERE folder_id = ? AND uid = ?', message.folderId, message.uid)
  }
}
