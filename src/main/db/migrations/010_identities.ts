import type { Database } from 'better-sqlite3'

/**
 * Sender identities: several addresses under one mailbox.
 *
 * An account is a connection to a server; an identity is a name and address to send under.
 * Keeping them apart is what allows one mailbox to answer as `info@`, `rechnung@` and by
 * name, all over the same IMAP and SMTP connection. Which is how aliases actually work at
 * the provider.
 */
export const migration010Identities = `
CREATE TABLE IF NOT EXISTS identities (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT '',
  email_address TEXT NOT NULL,
  signature TEXT NOT NULL DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_identities_account ON identities(account_id, sort_order);
`

/**
 * Gives every account the identity it has always implicitly had.
 *
 * Without this, existing accounts would show an empty sender list and composing would have
 * nothing to send under. The account's own address and signature become its default identity,
 * so nothing changes visibly until the user adds a second one.
 */
export function applyIdentitiesMigration(db: Database): void {
  const accountsWithout = db
    .prepare(
      `SELECT a.id as id, a.display_name as displayName, a.email_address as email,
              COALESCE(a.signature, '') as signature
       FROM accounts a
       WHERE NOT EXISTS (SELECT 1 FROM identities i WHERE i.account_id = a.id)`
    )
    .all() as { id: string; displayName: string; email: string; signature: string }[]

  if (accountsWithout.length === 0) return

  const insert = db.prepare(
    `INSERT INTO identities (id, account_id, display_name, email_address, signature, is_default, sort_order)
     VALUES (?, ?, ?, ?, ?, 1, 0)`
  )
  const tx = db.transaction(() => {
    for (const account of accountsWithout) {
      insert.run(
        `${account.id}-default`,
        account.id,
        account.displayName ?? '',
        account.email,
        account.signature
      )
    }
  })
  tx()
}
