import type { Database } from 'better-sqlite3'

/**
 * Puts a message aside until a chosen time.
 *
 * A column on `messages` rather than a table of its own: a snooze belongs to exactly one
 * message, disappears with it, and every list query has to know about it anyway. A join
 * would be one more table in the hot path for a single number.
 *
 * The value is an epoch in milliseconds, NULL when the message is not snoozed. Expiry needs
 * no job: the list queries compare against the current time, so a message comes back on the
 * next read whether or not the app was running when the moment arrived. The scheduler in the
 * main process only exists to notice it while nobody is looking.
 */
export function applySnoozeMigration(db: Database): void {
  const columns = db.prepare('PRAGMA table_info(messages)').all() as { name: string }[]
  if (!columns.some((c) => c.name === 'snoozed_until')) {
    db.exec('ALTER TABLE messages ADD COLUMN snoozed_until INTEGER')
  }
  // Every folder listing filters on this, and the scheduler asks for the smallest value
  // across the whole mailbox; both are index lookups rather than a scan of every message.
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_messages_snoozed ON messages(snoozed_until) WHERE snoozed_until IS NOT NULL'
  )
}
