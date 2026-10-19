import type { Database } from 'better-sqlite3'

export const migration006Settings = `
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

interface ColumnInfoRow {
  name: string
}

/** ALTER TABLE ADD COLUMN has no IF NOT EXISTS in SQLite, so gate each add on the live schema. */
function addColumnIfMissing(
  db: Database,
  table: string,
  column: string,
  definition: string
): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfoRow[]
  if (columns.some((c) => c.name === column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

export function applyAccountSettingsColumns(db: Database): void {
  addColumnIfMissing(db, 'accounts', 'signature', "TEXT NOT NULL DEFAULT ''")
  addColumnIfMissing(db, 'accounts', 'color', "TEXT NOT NULL DEFAULT '#2f5d9f'")
  addColumnIfMissing(db, 'accounts', 'encrypt_by_default', 'INTEGER NOT NULL DEFAULT 0')
}
