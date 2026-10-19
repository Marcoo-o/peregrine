import type { Database } from 'better-sqlite3'

/**
 * Where a message is headed once there is a connection again.
 *
 * Moving without a connection used to delete the row and queue the move. The queue part was
 * right, the deletion was not: until the target folder next synced, the message was in no
 * folder at all. Gone from the source, not yet in the target, unreachable from the list and
 * therefore impossible to act on a second time.
 *
 * The row now stays exactly where it is, because that is where the message still is: the
 * server has not been told anything yet. `folder_id` and `uid` keep matching the server, so
 * the invariant that made the deletion look necessary is never broken. Only the note that a
 * move is pending is new, and the list shows it.
 *
 * NULL means nothing is pending, which is nearly every row. Hence the partial index.
 */
export function applyPendingMoveMigration(db: Database): void {
  const columns = db.prepare('PRAGMA table_info(messages)').all() as { name: string }[]
  if (!columns.some((c) => c.name === 'pending_move_to')) {
    db.exec('ALTER TABLE messages ADD COLUMN pending_move_to TEXT')
  }
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_messages_pending_move ON messages(pending_move_to) WHERE pending_move_to IS NOT NULL'
  )
}
