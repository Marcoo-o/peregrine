import type { Database } from 'better-sqlite3'

/**
 * Filter rules grew from "one condition, one action" to "several conditions combined with
 * and/or, several actions". Conditions and actions are stored as JSON: they are always read
 * and written as a whole rule, never queried field by field, so separate tables would buy
 * nothing but joins.
 */
export const migration007FilterRulesV2 = ``

interface ColumnInfoRow {
  name: string
}

function addColumnIfMissing(db: Database, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfoRow[]
  if (columns.some((c) => c.name === column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

interface LegacyRuleRow {
  id: string
  condition_field: string | null
  condition_value: string | null
  action_type: string | null
  action_target_folder_id: string | null
  sort_order: number
}

/** Adds the new columns and lifts rules written by the single-condition schema into them. */
export function applyFilterRuleMigration(db: Database): void {
  addColumnIfMissing(db, 'filter_rules', 'match_mode', "TEXT NOT NULL DEFAULT 'all'")
  addColumnIfMissing(db, 'filter_rules', 'conditions_json', "TEXT NOT NULL DEFAULT '[]'")
  addColumnIfMissing(db, 'filter_rules', 'actions_json', "TEXT NOT NULL DEFAULT '[]'")

  // Old rows have empty JSON arrays; rebuild them from the legacy columns exactly once.
  const legacy = db
    .prepare(
      `SELECT id, condition_field, condition_value, action_type, action_target_folder_id, sort_order
       FROM filter_rules WHERE conditions_json = '[]'`
    )
    .all() as LegacyRuleRow[]
  if (legacy.length === 0) return

  const update = db.prepare(
    'UPDATE filter_rules SET conditions_json = ?, actions_json = ? WHERE id = ?'
  )
  const tx = db.transaction((rows: LegacyRuleRow[]) => {
    for (const row of rows) {
      if (!row.condition_field || !row.action_type) continue
      const conditions = [
        { field: row.condition_field, operator: 'contains', value: row.condition_value ?? '' }
      ]
      const actions = [{ type: row.action_type, targetFolderId: row.action_target_folder_id }]
      update.run(JSON.stringify(conditions), JSON.stringify(actions), row.id)
    }
  })
  tx(legacy)
}
