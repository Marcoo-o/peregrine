import type { SecureMode } from '@peregrine/core/types'
import type { SqlDb } from '@peregrine/core/sqlDb'
import type { FetchedMessage } from '@peregrine/core/imapSession'

export interface Account {
  host: string
  port: number
  secure: SecureMode
  username: string
  password: string
}

export interface StoredMessage {
  uid: number
  subject: string
  sender: string
  dateMs: number | null
  flags: string[]
  size: number
  hasAttachment: boolean
}

export async function loadAccount(db: SqlDb): Promise<Account | undefined> {
  return db.get<Account>('SELECT host, port, secure, username, password FROM account WHERE id = 1')
}

export async function saveAccount(db: SqlDb, account: Account): Promise<void> {
  await db.run(
    `INSERT INTO account (id, host, port, secure, username, password) VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET host = excluded.host, port = excluded.port,
       secure = excluded.secure, username = excluded.username, password = excluded.password`,
    account.host,
    account.port,
    account.secure,
    account.username,
    account.password
  )
}

/** Removes the account and everything fetched for it. */
export async function forgetAccount(db: SqlDb): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM message')
    await tx.run('DELETE FROM account')
  })
}

function sender(message: FetchedMessage): string {
  const from = message.envelope.from?.[0]
  if (!from) return ''
  return from.name ? `${from.name} <${from.address ?? ''}>` : (from.address ?? '')
}

/** Stores what a sync fetched, replacing what was there for the same message. */
export async function saveMessages(
  db: SqlDb,
  folder: string,
  messages: FetchedMessage[]
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const message of messages) {
      await tx.run(
        `INSERT OR REPLACE INTO message
           (folder, uid, subject, sender, date_ms, flags, size, has_attachment)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        folder,
        message.uid,
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

/** The newest messages of a folder first. */
export async function listMessages(db: SqlDb, folder: string): Promise<StoredMessage[]> {
  const rows = await db.all<{
    uid: number
    subject: string
    sender: string
    date_ms: number | null
    flags: string
    size: number
    has_attachment: number
  }>(
    `SELECT uid, subject, sender, date_ms, flags, size, has_attachment FROM message
     WHERE folder = ? ORDER BY uid DESC`,
    folder
  )
  return rows.map((row) => ({
    uid: row.uid,
    subject: row.subject,
    sender: row.sender,
    dateMs: row.date_ms,
    flags: JSON.parse(row.flags) as string[],
    size: row.size,
    hasAttachment: row.has_attachment === 1
  }))
}
