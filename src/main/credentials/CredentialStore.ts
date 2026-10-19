import type { SqlDb } from '../db/sqlDb'
import { decryptSecret, encryptSecret } from './secureStore'

interface CredentialRow {
  imap_secret_encrypted: Buffer | null
  smtp_secret_encrypted: Buffer | null
}

export async function saveCredentials(
  db: SqlDb,
  accountId: string,
  imapPassword: string,
  smtpPassword: string
): Promise<void> {
  const imapEncrypted = encryptSecret(imapPassword)
  const smtpEncrypted = encryptSecret(smtpPassword)

  await db.run(
    `INSERT INTO credentials (account_id, imap_secret_encrypted, smtp_secret_encrypted)
     VALUES (?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET
       imap_secret_encrypted = excluded.imap_secret_encrypted,
       smtp_secret_encrypted = excluded.smtp_secret_encrypted,
       updated_at = datetime('now')`,
    accountId,
    imapEncrypted,
    smtpEncrypted
  )
}

/** Partial update for the "edit account" flow, where blank password fields mean "keep current". */
export async function updateCredentials(
  db: SqlDb,
  accountId: string,
  imapPassword?: string,
  smtpPassword?: string
): Promise<void> {
  if (imapPassword) {
    await db.run(
      "UPDATE credentials SET imap_secret_encrypted = ?, updated_at = datetime('now') WHERE account_id = ?",
      encryptSecret(imapPassword),
      accountId
    )
  }
  if (smtpPassword) {
    await db.run(
      "UPDATE credentials SET smtp_secret_encrypted = ?, updated_at = datetime('now') WHERE account_id = ?",
      encryptSecret(smtpPassword),
      accountId
    )
  }
}

export interface AccountSecrets {
  imapPassword: string
  smtpPassword: string
}

export async function loadCredentials(
  db: SqlDb,
  accountId: string
): Promise<AccountSecrets | undefined> {
  const row = await db.get<CredentialRow>(
    'SELECT imap_secret_encrypted, smtp_secret_encrypted FROM credentials WHERE account_id = ?',
    accountId
  )

  if (!row || !row.imap_secret_encrypted || !row.smtp_secret_encrypted) return undefined

  return {
    imapPassword: decryptSecret(row.imap_secret_encrypted),
    smtpPassword: decryptSecret(row.smtp_secret_encrypted)
  }
}
