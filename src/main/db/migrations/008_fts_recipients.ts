import type { Database } from 'better-sqlite3'

/**
 * Widens the full-text index by the recipients.
 *
 * `messages_fts` is an external-content table: FTS5 reads its columns straight out of
 * `messages` by name, so an indexable "recipients" column has to exist there as a real
 * column. The JSON in `to_addresses`/`cc_addresses` cannot be indexed as it stands.
 * `recipients_text` holds the flattened names and addresses and is written alongside them.
 *
 * FTS5 cannot gain a column after the fact, so the table is dropped and recreated. That is
 * safe here because it stores no data of its own; `rebuild` restores it from `messages`.
 */
export const migration008FtsRecipients = ``

const FTS_COLUMNS = 'subject, body_text, from_name, from_address, recipients_text'

const CREATE_FTS = `
CREATE VIRTUAL TABLE messages_fts USING fts5(
  ${FTS_COLUMNS},
  content='messages', content_rowid='rowid'
);
`

// Triggers are recreated together with the table: they name every indexed column, so the
// definition in 002 (which predates recipients_text) would no longer match the schema.
const CREATE_TRIGGERS = `
CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, ${FTS_COLUMNS})
  VALUES (new.rowid, new.subject, new.body_text, new.from_name, new.from_address, new.recipients_text);
END;

CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, ${FTS_COLUMNS})
  VALUES('delete', old.rowid, old.subject, old.body_text, old.from_name, old.from_address, old.recipients_text);
END;

CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, ${FTS_COLUMNS})
  VALUES('delete', old.rowid, old.subject, old.body_text, old.from_name, old.from_address, old.recipients_text);
  INSERT INTO messages_fts(rowid, ${FTS_COLUMNS})
  VALUES (new.rowid, new.subject, new.body_text, new.from_name, new.from_address, new.recipients_text);
END;
`

interface ColumnInfoRow {
  name: string
}

function columnNames(db: Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfoRow[]).map((c) => c.name)
}

interface AddressRow {
  rowid: number
  to_addresses: string | null
  cc_addresses: string | null
}

function flattenAddresses(json: string | null): string {
  if (!json) return ''
  try {
    const parsed = JSON.parse(json) as Array<{ name?: string; address?: string }>
    if (!Array.isArray(parsed)) return ''
    return parsed
      .map((entry) => [entry.name, entry.address].filter(Boolean).join(' '))
      .filter(Boolean)
      .join(' ')
  } catch {
    return ''
  }
}

/** Flattens To and Cc into the single string the index searches over. */
export function recipientsText(
  to: Array<{ name?: string; address?: string }>,
  cc: Array<{ name?: string; address?: string }>
): string {
  return [...to, ...cc]
    .map((entry) => [entry.name, entry.address].filter(Boolean).join(' '))
    .filter(Boolean)
    .join(' ')
}

export function applyFtsRecipientsMigration(db: Database): void {
  if (!columnNames(db, 'messages').includes('recipients_text')) {
    db.exec('ALTER TABLE messages ADD COLUMN recipients_text TEXT')
  }

  // Fill in what the envelope sync already stored as JSON, so existing mail becomes
  // findable by recipient without a resync. Runs once. Afterwards nothing is NULL.
  const pending = db
    .prepare(
      `SELECT rowid, to_addresses, cc_addresses FROM messages WHERE recipients_text IS NULL`
    )
    .all() as AddressRow[]
  if (pending.length > 0) {
    const update = db.prepare('UPDATE messages SET recipients_text = ? WHERE rowid = ?')
    const tx = db.transaction((rows: AddressRow[]) => {
      for (const row of rows) {
        const text = [flattenAddresses(row.to_addresses), flattenAddresses(row.cc_addresses)]
          .filter(Boolean)
          .join(' ')
        update.run(text, row.rowid)
      }
    })
    tx(pending)
  }

  if (columnNames(db, 'messages_fts').includes('recipients_text')) return

  db.exec(`
    DROP TRIGGER IF EXISTS messages_ai;
    DROP TRIGGER IF EXISTS messages_ad;
    DROP TRIGGER IF EXISTS messages_au;
    DROP TABLE IF EXISTS messages_fts;
    ${CREATE_FTS}
    ${CREATE_TRIGGERS}
    INSERT INTO messages_fts(messages_fts) VALUES('rebuild');
  `)
}
