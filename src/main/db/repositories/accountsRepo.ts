import type { SqlDb } from '../sqlDb'
import { randomUUID } from 'node:crypto'
import { nextAccountColor } from '@peregrine/core/accountColors'
import type { AccountSummary, SecureMode } from '@peregrine/core/types'

interface AccountRow {
  id: string
  display_name: string
  email_address: string
  imap_host: string
  imap_port: number
  imap_secure: SecureMode
  imap_username: string
  smtp_host: string
  smtp_port: number
  smtp_secure: SecureMode
  smtp_username: string
  auth_type: 'password' | 'oauth2'
  sort_order: number
  signature: string
  color: string
  encrypt_by_default: number
}

function toSummary(row: AccountRow): AccountSummary {
  return {
    id: row.id,
    displayName: row.display_name,
    emailAddress: row.email_address,
    imapHost: row.imap_host,
    imapPort: row.imap_port,
    imapSecure: row.imap_secure,
    imapUsername: row.imap_username,
    smtpHost: row.smtp_host,
    smtpPort: row.smtp_port,
    smtpSecure: row.smtp_secure,
    smtpUsername: row.smtp_username,
    authType: row.auth_type,
    sortOrder: row.sort_order,
    signature: row.signature ?? '',
    color: row.color ?? '#2f5d9f',
    encryptByDefault: row.encrypt_by_default === 1
  }
}

export interface NewAccountRow {
  displayName: string
  emailAddress: string
  imapHost: string
  imapPort: number
  imapSecure: SecureMode
  imapUsername: string
  smtpHost: string
  smtpPort: number
  smtpSecure: SecureMode
  smtpUsername: string
}

export async function listAccounts(db: SqlDb): Promise<AccountSummary[]> {
  const rows = await db.all<AccountRow>(
    'SELECT * FROM accounts ORDER BY sort_order ASC, created_at ASC'
  )
  return rows.map(toSummary)
}

export async function getAccount(db: SqlDb, accountId: string): Promise<AccountSummary | undefined> {
  const row = await db.get<AccountRow>('SELECT * FROM accounts WHERE id = ?', accountId)
  return row ? toSummary(row) : undefined
}

export async function insertAccount(db: SqlDb, input: NewAccountRow): Promise<string> {
  const id = randomUUID()
  // The position and the colour both come from what is there already, so reading them and
  // inserting have to be one step. Two accounts added at once would otherwise share both.
  await db.transaction(async (tx) => {
    const maxSortOrder = (
      await tx.get<{ maxOrder: number | null }>('SELECT MAX(sort_order) as maxOrder FROM accounts')
    )?.maxOrder
    const sortOrder = (maxSortOrder ?? -1) + 1

    // A colour of its own, handed out round robin. None was set before, the column fell back to
    // its default, and every account carried the same dot, on the very feature meant to tell them
    // apart in the sidebar and in the message list.
    const { count } = (await tx.get<{ count: number }>('SELECT COUNT(*) AS count FROM accounts'))!
    const color = nextAccountColor(count)

    await tx.run(
      `INSERT INTO accounts (
        id, display_name, email_address,
        imap_host, imap_port, imap_secure, imap_username,
        smtp_host, smtp_port, smtp_secure, smtp_username,
        sort_order, color
      ) VALUES (@id, @displayName, @emailAddress, @imapHost, @imapPort, @imapSecure, @imapUsername, @smtpHost, @smtpPort, @smtpSecure, @smtpUsername, @sortOrder, @color)`,
      { id, sortOrder, color, ...input }
    )
  })

  return id
}

export async function deleteAccount(db: SqlDb, accountId: string): Promise<void> {
  await db.run('DELETE FROM accounts WHERE id = ?', accountId)
}

const UPDATABLE_COLUMNS: Record<string, string> = {
  displayName: 'display_name',
  signature: 'signature',
  color: 'color',
  encryptByDefault: 'encrypt_by_default',
  imapHost: 'imap_host',
  imapPort: 'imap_port',
  imapSecure: 'imap_secure',
  imapUsername: 'imap_username',
  smtpHost: 'smtp_host',
  smtpPort: 'smtp_port',
  smtpSecure: 'smtp_secure',
  smtpUsername: 'smtp_username'
}

export async function updateAccount(
  db: SqlDb,
  accountId: string,
  patch: Record<string, string | number | boolean | undefined>
): Promise<void> {
  const assignments: string[] = []
  const values: (string | number)[] = []

  for (const [key, column] of Object.entries(UPDATABLE_COLUMNS)) {
    const value = patch[key]
    if (value === undefined) continue
    assignments.push(`${column} = ?`)
    values.push(typeof value === 'boolean' ? (value ? 1 : 0) : value)
  }

  if (assignments.length === 0) return
  values.push(accountId)
  await db.run(`UPDATE accounts SET ${assignments.join(', ')} WHERE id = ?`, ...values)
}

export async function setAccountSortOrder(
  db: SqlDb,
  accountId: string,
  sortOrder: number
): Promise<void> {
  await db.run('UPDATE accounts SET sort_order = ? WHERE id = ?', sortOrder, accountId)
}
