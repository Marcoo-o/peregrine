import type { Database } from 'better-sqlite3'

/**
 * One index per sort column, matching the sort expressions exactly.
 *
 * The list can be ordered by date, subject, sender or size. Only the first of those had an
 * index; the other three fell back to reading every row of the folder and sorting the lot in
 * memory. At nine hundred messages that is invisible, at a hundred thousand it is the whole
 * cost of opening a folder.
 *
 * The expressions are copied verbatim from `SORT_EXPRESSIONS`, `COALESCE` included. SQLite
 * only uses an index on an expression when the query says exactly the same thing. A
 * difference as small as a missing COALESCE turns the lookup back into a scan, silently.
 *
 * `folder_id` leads every one of them because the list is always restricted to folders, and
 * the rowid comes along for free as the tie-breaker the ORDER BY uses.
 *
 * The old `idx_messages_folder_date` on the bare column is dropped: with the sort key now
 * wrapped in COALESCE it can never be used again, and an index nobody reads still has to be
 * written on every insert.
 */
export function applySortIndexesMigration(db: Database): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_sort_date
      ON messages(folder_id, COALESCE(date, ''));
    CREATE INDEX IF NOT EXISTS idx_messages_sort_subject
      ON messages(folder_id, COALESCE(subject, '') COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_messages_sort_from
      ON messages(folder_id, COALESCE(NULLIF(from_name, ''), from_address, '') COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_messages_sort_size
      ON messages(folder_id, COALESCE(size_bytes, 0));
    DROP INDEX IF EXISTS idx_messages_folder_date;
  `)
}
