import { nextAccountColor } from '@peregrine/core/accountColors'
import type { SecureMode } from '@peregrine/core/types'
import type { SqlDb } from '@peregrine/core/sqlDb'
import { newId } from './ids'
import { addIdentity } from './identities'

export interface Account {
  id: string
  displayName: string
  emailAddress: string
  imapHost: string
  imapPort: number
  imapSecure: SecureMode
  imapUsername: string
  /** Nothing yet asks for these, so they are empty until sending is in the screens. */
  smtpHost: string | null
  smtpPort: number | null
  smtpSecure: SecureMode | null
  smtpUsername: string | null
  password: string
  /** When it is not the same as `password`. */
  smtpPassword: string | null
  /** What tells it from the other accounts in a list, given when it is added. */
  color: string
  createdAt: number
}

/** What an account is made from. Its colour is not the caller's to choose, it is given. */
export type NewAccount = Omit<Account, 'id' | 'createdAt' | 'color'>

interface AccountRow {
  id: string
  display_name: string
  email_address: string
  imap_host: string
  imap_port: number
  imap_secure: string
  imap_username: string
  smtp_host: string | null
  smtp_port: number | null
  smtp_secure: string | null
  smtp_username: string | null
  password: string
  smtp_password: string | null
  color: string
  created_at: number
}

const COLUMNS =
  `id, display_name, email_address, imap_host, imap_port, imap_secure, imap_username,
   smtp_host, smtp_port, smtp_secure, smtp_username, password, smtp_password, color, created_at`

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    displayName: row.display_name,
    emailAddress: row.email_address,
    imapHost: row.imap_host,
    imapPort: row.imap_port,
    imapSecure: row.imap_secure as SecureMode,
    imapUsername: row.imap_username,
    smtpHost: row.smtp_host,
    smtpPort: row.smtp_port,
    smtpSecure: row.smtp_secure as SecureMode | null,
    smtpUsername: row.smtp_username,
    password: row.password,
    smtpPassword: row.smtp_password,
    color: row.color,
    createdAt: row.created_at
  }
}

/** In the order they were added, which is the order they are shown in until somebody orders them. */
export async function listAccounts(db: SqlDb): Promise<Account[]> {
  const rows = await db.all<AccountRow>(`SELECT ${COLUMNS} FROM accounts ORDER BY created_at, id`)
  return rows.map(toAccount)
}

export async function getAccount(db: SqlDb, id: string): Promise<Account | undefined> {
  const row = await db.get<AccountRow>(`SELECT ${COLUMNS} FROM accounts WHERE id = ?`, id)
  return row ? toAccount(row) : undefined
}

/** Adds an account and returns it, with the id it was given. */
export async function addAccount(
  db: SqlDb,
  input: NewAccount,
  options: { id?: string; now?: number } = {}
): Promise<Account> {
  const id = options.id ?? newId()
  const createdAt = options.now ?? Date.now()
  const existing = await db.get<{ count: number }>('SELECT COUNT(*) AS count FROM accounts')
  const color = nextAccountColor(existing?.count ?? 0)
  await db.run(
    `INSERT INTO accounts (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.displayName,
    input.emailAddress,
    input.imapHost,
    input.imapPort,
    input.imapSecure,
    input.imapUsername,
    input.smtpHost,
    input.smtpPort,
    input.smtpSecure,
    input.smtpUsername,
    input.password,
    input.smtpPassword,
    color,
    createdAt
  )
  await addIdentity(db, { accountId: id, displayName: input.displayName, emailAddress: input.emailAddress, signature: '' }, { id: `${id}-default` })
  return { ...input, id, createdAt, color }
}

/** What of an account the user can change: everything but what it is called by (its id), when it was made, and the colour it was given... which they can change too. */
export type AccountPatch = Partial<Omit<Account, 'id' | 'createdAt'>>

const COLUMN_OF: Record<keyof AccountPatch, string> = {
  displayName: 'display_name',
  emailAddress: 'email_address',
  imapHost: 'imap_host',
  imapPort: 'imap_port',
  imapSecure: 'imap_secure',
  imapUsername: 'imap_username',
  smtpHost: 'smtp_host',
  smtpPort: 'smtp_port',
  smtpSecure: 'smtp_secure',
  smtpUsername: 'smtp_username',
  password: 'password',
  smtpPassword: 'smtp_password',
  color: 'color'
}

/**
 * Changes some of what an account is and returns it as it is stored now, or undefined for an account that is not there. What is not in the patch
 * is left as it is; a value that is `null` in it is stored as nothing, which is how an account loses its server for sending.
 */
export async function updateAccount(db: SqlDb, id: string, patch: AccountPatch): Promise<Account | undefined> {
  const keys = (Object.keys(patch) as Array<keyof AccountPatch>).filter((key) => patch[key] !== undefined)
  if (keys.length > 0) {
    await db.run(`UPDATE accounts SET ${keys.map((key) => `${COLUMN_OF[key]} = ?`).join(', ')} WHERE id = ?`, ...keys.map((key) => patch[key]), id)
  }
  return getAccount(db, id)
}

/**
 * Removes an account and everything of it: its folders, its messages, its own keys, and what waits in the queue
 * for it. In one transaction, so that a failure part way does not leave an account that is gone and
 * messages that belong to nobody. The database has no foreign keys to do this, and a queued action
 * for an account that does not exist would be replayed against nothing.
 */
export async function removeAccount(db: SqlDb, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM pending_actions WHERE account_id = ?', id)
    await tx.run('DELETE FROM messages WHERE account_id = ?', id)
    await tx.run('DELETE FROM folders WHERE account_id = ?', id)
    await tx.run('DELETE FROM own_keys WHERE account_id = ?', id)
    await tx.run('DELETE FROM identities WHERE account_id = ?', id)
    await tx.run('DELETE FROM filter_rules WHERE account_id = ?', id)
    await tx.run('DELETE FROM accounts WHERE id = ?', id)
  })
}
