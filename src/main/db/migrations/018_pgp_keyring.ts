import type { Database } from 'better-sqlite3'

/**
 * One key per account and per contact becomes a keyring.
 *
 * `account_pgp_keys` had `account_id` as its primary key, so replacing a key overwrote the
 * old one. For a contact that costs the ability to check old signatures. For one's own
 * account it costs far more: mail encrypted to the old key stays encrypted to it forever, and
 * dropping that key locks the mailbox owner out of their own archive.
 *
 * The fix is a keyring per identity with exactly one active key. The active key is what signs
 * and what others encrypt to; every key, active or not, still decrypts and still verifies. So
 * rotating a key becomes what it should always have been. A change of what is used going
 * forward, not the deletion of the past.
 *
 * The tables are rebuilt rather than altered because SQLite cannot change a primary key in
 * place. Existing rows carry over as the active key, which is what they were.
 */
export function applyPgpKeyringMigration(db: Database): void {
  const accountDone = hasColumn(db, 'account_pgp_keys', 'is_active')
  const contactDone = hasColumn(db, 'contact_pgp_keys', 'is_active')
  if (accountDone && contactDone) return

  // Foreign keys are checked per statement, and the rename below would briefly leave the
  // referencing tables pointing at a table that no longer exists. Switched off around the
  // rebuild only. And outside the transaction, where SQLite ignores the pragma.
  db.pragma('foreign_keys = OFF')
  try {
    db.transaction(() => {
      if (!accountDone) rebuildAccountKeys(db)
      if (!contactDone) rebuildContactKeys(db)
    })()
  } finally {
    db.pragma('foreign_keys = ON')
  }
}

function hasColumn(db: Database, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return columns.some((c) => c.name === column)
}

function rebuildAccountKeys(db: Database): void {
  db.exec(`
    CREATE TABLE account_pgp_keys_new (
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL,
      public_key_armored TEXT NOT NULL,
      private_key_encrypted BLOB NOT NULL,
      /* Exactly one per account: what signs, and what others are told to encrypt to. */
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (account_id, fingerprint)
    );

    INSERT INTO account_pgp_keys_new
      (account_id, fingerprint, public_key_armored, private_key_encrypted, is_active, created_at)
    SELECT account_id, fingerprint, public_key_armored, private_key_encrypted, 1, created_at
    FROM account_pgp_keys;

    DROP TABLE account_pgp_keys;
    ALTER TABLE account_pgp_keys_new RENAME TO account_pgp_keys;

    /* Enforced rather than trusted: two active keys would make signing a coin toss. */
    CREATE UNIQUE INDEX IF NOT EXISTS idx_account_pgp_active
      ON account_pgp_keys(account_id) WHERE is_active = 1;
  `)
}

function rebuildContactKeys(db: Database): void {
  db.exec(`
    CREATE TABLE contact_pgp_keys_new (
      contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL,
      public_key_armored TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      discovered_for_account_id TEXT,
      updated_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (contact_id, fingerprint)
    );

    INSERT INTO contact_pgp_keys_new
      (contact_id, fingerprint, public_key_armored, source, discovered_for_account_id,
       updated_at, is_active, created_at)
    SELECT contact_id, fingerprint, public_key_armored, source, discovered_for_account_id,
           updated_at, 1, created_at
    FROM contact_pgp_keys;

    DROP TABLE contact_pgp_keys;
    ALTER TABLE contact_pgp_keys_new RENAME TO contact_pgp_keys;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_pgp_active
      ON contact_pgp_keys(contact_id) WHERE is_active = 1;
  `)
}
