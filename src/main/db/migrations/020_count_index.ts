import type { Database } from 'better-sqlite3'

/**
 * A covering index for the counter in the list header.
 *
 * The header says how many messages the list holds, and a `COUNT(*)` over exactly the list's
 * own condition works that out. The folder part was indexed, the rest was not, and a condition
 * on a column missing from the index cannot be answered from it. SQLite found the candidates
 * through the index and then fetched each row from disk just to check one field.
 *
 * Measured at 100,000 messages across four folders:
 *
 * | | before | after |
 * |---|---|---|
 * | count, one folder | 61 ms | 1.4 ms |
 * | count, four folders | 248 ms | 5.9 ms |
 * | first page, unread | 64 ms | 2.1 ms |
 * | first page, flagged | 62 ms | 2.4 ms |
 * | first page, with attachment | 64 ms | 2.3 ms |
 * | first page, tagged | 66 ms | 3.3 ms |
 *
 * This only ever applied to the first page, because the count is carried forward in the page
 * cursor afterwards. So it cost nothing while paging and everything when opening a folder,
 * which is the moment somebody is waiting.
 *
 * **The column order is not arbitrary.** `folder_id` leads because every list restricts by it.
 * `snoozed_until` follows because every list filters on that as well. The rest are the four
 * possible quick filters. An intermediate version without `flags` measured worse than no index
 * at all. The tag filter rose from 66 to **100 ms**, because SQLite chose the new index and
 * still had to touch the rows. An index that answers half the question is worse than none.
 *
 * Cost: 5.1 instead of 4.4 MB at 100,000 messages, so 0.7 MB on a 97 MB database.
 *
 * `idx_messages_snoozed` from the snooze migration stays alongside it. That one is partial
 * (`WHERE snoozed_until IS NOT NULL`) and answers the scheduler's question, the smallest value
 * across the whole mailbox, which this index cannot answer better.
 */
export function applyCountIndexMigration(db: Database): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_list_count
      ON messages(folder_id, snoozed_until, is_read, is_flagged, has_attachments, flags);
    DROP INDEX IF EXISTS idx_messages_folder_snooze;
  `)
}
