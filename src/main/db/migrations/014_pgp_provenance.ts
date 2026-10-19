import type { Database } from 'better-sqlite3'

/**
 * Where a contact's key came from, and when.
 *
 * A fingerprint on its own says nothing about how much it is worth. A key fetched from the
 * domain's own Web Key Directory was published by whoever runs that domain; one pasted out
 * of an email was published by whoever wrote the email. Both end up in the same column
 * today, and the difference is exactly the one that matters when deciding whether to trust
 * an encrypted reply.
 *
 * `discovered_for_account_id` records which mailbox was open when the key arrived. The key
 * itself stays shared across accounts on purpose: a public key belongs to a person, not to
 * one of my mailboxes. Storing it per account would mean fetching it while reading in one
 * account and then failing to encrypt from another. The same key, refused because it was
 * found on the wrong day.
 */
export function applyPgpProvenanceMigration(db: Database): void {
  const columns = db.prepare('PRAGMA table_info(contact_pgp_keys)').all() as { name: string }[]
  const has = (name: string): boolean => columns.some((c) => c.name === name)

  if (!has('source')) {
    // Existing rows predate the distinction; 'manual' is the honest answer for them, since
    // pasting by hand was the only way to get a key in before the lookup existed.
    db.exec(`ALTER TABLE contact_pgp_keys ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'`)
  }
  if (!has('discovered_for_account_id')) {
    db.exec('ALTER TABLE contact_pgp_keys ADD COLUMN discovered_for_account_id TEXT')
  }
  if (!has('updated_at')) {
    // Not NOT NULL: SQLite refuses a non-constant default on ALTER TABLE, and backfilling
    // created_at would claim a date that is not the truth for rows that were never updated.
    db.exec('ALTER TABLE contact_pgp_keys ADD COLUMN updated_at TEXT')
  }
}
