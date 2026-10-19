import type { Database } from 'better-sqlite3'

/**
 * Keeps the raw source of PGP messages.
 *
 * A detached signature can only be checked against the exact bytes it was made over, and
 * those bytes are gone as soon as a message has been parsed into text and HTML. Storing the
 * source is also what keeps encrypted mail encrypted on disk: the database holds the
 * ciphertext, and decryption happens on every read instead of once at sync time.
 *
 * Only PGP messages get a value here. For everything else the column stays NULL.
 */
export function applyPgpSourceMigration(db: Database): void {
  const columns = db.prepare('PRAGMA table_info(messages)').all() as { name: string }[]
  if (columns.some((c) => c.name === 'raw_source')) return
  db.exec('ALTER TABLE messages ADD COLUMN raw_source TEXT')
}
