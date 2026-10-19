import Database from 'better-sqlite3-multiple-ciphers'
import { migration001Init } from './migrations/001_init'
import { migration002FtsTriggers } from './migrations/002_fts_triggers'
import { migration003FilterRules } from './migrations/003_filter_rules'
import { migration004Contacts } from './migrations/004_contacts'
import { migration005PgpKeys } from './migrations/005_pgp_keys'
import { applyAccountSettingsColumns, migration006Settings } from './migrations/006_settings'
import {
  applyFilterRuleMigration,
  migration007FilterRulesV2
} from './migrations/007_filter_rules_v2'
import {
  applyFtsRecipientsMigration,
  migration008FtsRecipients
} from './migrations/008_fts_recipients'
import { applyPgpSourceMigration } from './migrations/009_pgp_source'
import { applyIdentitiesMigration, migration010Identities } from './migrations/010_identities'
import { migration011Tags } from './migrations/011_tags'
import { applySnoozeMigration } from './migrations/012_snooze'
import { migration013PendingActions } from './migrations/013_pending_actions'
import { applyPgpProvenanceMigration } from './migrations/014_pgp_provenance'
import { migration015Tasks } from './migrations/015_tasks'
import { applyScheduledSendMigration } from './migrations/016_scheduled_send'
import { applySortIndexesMigration } from './migrations/017_sort_indexes'
import { applyPgpKeyringMigration } from './migrations/018_pgp_keyring'
import { applyPendingMoveMigration } from './migrations/019_pending_move'
import { applyCountIndexMigration } from './migrations/020_count_index'
import { applyAccountColorsMigration } from './migrations/021_account_colors'
import { BetterSqliteDb } from './sqlDb'

let db: BetterSqliteDb | null = null

// The FTS triggers only cover future writes; if the FTS index is empty but messages already
// exist (e.g. upgrading from a version predating full-text search), rebuild it once from
// current content so already-synced mail becomes searchable without a full resync.
//
// Note: `SELECT COUNT(*) FROM messages_fts` is NOT a valid emptiness check here. For an
// external-content FTS5 table, querying the virtual table without a MATCH clause transparently
// reads through to the backing `messages` table, so it returns the message count even when the
// FTS index itself (messages_fts_docsize) has never been built. Check the shadow table instead.
function backfillFtsIfNeeded(database: Database.Database): void {
  const messageCount = (database.prepare('SELECT COUNT(*) as c FROM messages').get() as { c: number }).c
  if (messageCount === 0) return
  const docsizeCount = (
    database.prepare('SELECT COUNT(*) as c FROM messages_fts_docsize').get() as { c: number }
  ).c
  if (docsizeCount === 0) {
    database.exec(`INSERT INTO messages_fts(messages_fts) VALUES('rebuild')`)
  }
}

/**
 * Opens a profile's database.
 *
 * `encryptionKey` is the scrypt-derived key. It has to be applied before anything else reads
 * the file, and the read below forces the failure to happen here: with a wrong key SQLCipher
 * reports "file is not a database", and that has to surface as a wrong password rather than
 * as a crash in whatever query happens to run first.
 */
export function openDb(dbPath: string, encryptionKey: string | null): BetterSqliteDb {
  if (db) return db

  // Everything below is synchronous on purpose. It runs once, before anything else holds the
  // handle, and the migrations are plain SQL that has no reason to wait for anything.
  const raw = new Database(dbPath)
  try {
    if (encryptionKey) {
      raw.pragma(`key = "x'${encryptionKey}'"`)
    }
    raw.prepare('SELECT count(*) FROM sqlite_master').get()

    raw.pragma('journal_mode = WAL')
    raw.pragma('foreign_keys = ON')
    migrate(raw)
  } catch (err) {
    // Nothing owns the connection yet, so a wrong password would leave the file open.
    raw.close()
    throw err
  }

  db = new BetterSqliteDb(raw)
  return db
}

function migrate(db: Database.Database): void {
  db.exec(migration001Init)
  db.exec(migration002FtsTriggers)
  db.exec(migration003FilterRules)
  db.exec(migration004Contacts)
  db.exec(migration005PgpKeys)
  db.exec(migration006Settings)
  if (migration007FilterRulesV2) db.exec(migration007FilterRulesV2)
  if (migration008FtsRecipients) db.exec(migration008FtsRecipients)
  applyAccountSettingsColumns(db)
  applyFilterRuleMigration(db)
  // Must run before the backfill check: it may replace the FTS table, and rebuilds it itself.
  applyFtsRecipientsMigration(db)
  db.exec(migration010Identities)
  db.exec(migration011Tags)
  db.exec(migration013PendingActions)
  db.exec(migration015Tasks)
  applyPgpSourceMigration(db)
  applyIdentitiesMigration(db)
  applySnoozeMigration(db)
  applyPgpProvenanceMigration(db)
  applyScheduledSendMigration(db)
  applySortIndexesMigration(db)
  applyPgpKeyringMigration(db)
  applyPendingMoveMigration(db)
  applyCountIndexMigration(db)
  applyAccountColorsMigration(db)
  backfillFtsIfNeeded(db)
}

export function closeDb(): void {
  db?.close()
  db = null
}

/**
 * Changes the key an existing database is encrypted with.
 *
 * `rekey` rewrites every page, so it is not instant on a large mailbox. But it is the only
 * way to add or remove a password without exporting and reimporting everything. Passing null
 * removes the encryption entirely.
 */
export async function rekeyDb(database: BetterSqliteDb, newKey: string | null): Promise<void> {
  // Re-keying rewrites every page and SQLCipher refuses to do that in WAL mode, since the
  // write-ahead log would still hold pages under the old key. Switching the journal back and
  // forth around it is the supported way; a crash in between leaves the database readable and
  // merely in the slower journal mode, which the next start puts right.
  //
  // Taken through the connection's own lock, so that no query from another task runs between
  // the journal switch and the rekey.
  await database.withRawConnection((raw) => {
    raw.pragma('journal_mode = DELETE')
    try {
      raw.pragma(newKey ? `rekey = "x'${newKey}'"` : `rekey = ''`)
    } finally {
      raw.pragma('journal_mode = WAL')
    }
  })
}
