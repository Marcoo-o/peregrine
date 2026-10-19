import type { Database } from 'better-sqlite3'

/**
 * A time at which a queued action may first run.
 *
 * The outbox already holds messages that could not go out; a scheduled send is the same row
 * with a moment attached. NULL means "as soon as possible", which is what everything queued
 * so far meant implicitly. So the column needs no backfill.
 *
 * The index is partial on purpose: the scheduler only ever asks for the earliest future
 * value, and rows without one are the common case.
 */
export function applyScheduledSendMigration(db: Database): void {
  const columns = db.prepare('PRAGMA table_info(pending_actions)').all() as { name: string }[]
  if (!columns.some((c) => c.name === 'due_at')) {
    db.exec('ALTER TABLE pending_actions ADD COLUMN due_at INTEGER')
  }
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_pending_due ON pending_actions(due_at) WHERE due_at IS NOT NULL'
  )
}
