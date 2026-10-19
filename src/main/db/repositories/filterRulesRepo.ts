import type { SqlDb } from '../sqlDb'
import { randomUUID } from 'node:crypto'
import type { FilterAction, FilterCondition, FilterRule, FilterRuleInput } from '@peregrine/core/types'

interface FilterRuleRow {
  id: string
  account_id: string
  name: string
  match_mode: string
  conditions_json: string
  actions_json: string
  enabled: number
  sort_order: number
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function toFilterRule(row: FilterRuleRow): FilterRule {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    matchMode: row.match_mode === 'any' ? 'any' : 'all',
    conditions: parseJson<FilterCondition[]>(row.conditions_json, []),
    actions: parseJson<FilterAction[]>(row.actions_json, []),
    enabled: row.enabled === 1,
    priority: row.sort_order
  }
}

export async function listFilterRules(db: SqlDb, accountId: string): Promise<FilterRule[]> {
  const rows = await db.all<FilterRuleRow>(
    'SELECT * FROM filter_rules WHERE account_id = ? ORDER BY sort_order ASC',
    accountId
  )
  return rows.map(toFilterRule)
}

export async function createFilterRule(db: SqlDb, input: FilterRuleInput): Promise<string> {
  const id = randomUUID()
  // The next position comes from the highest one in use, so reading it and inserting are one step.
  await db.transaction(async (tx) => {
    const maxSortOrder = (
      await tx.get<{ m: number | null }>(
        'SELECT MAX(sort_order) as m FROM filter_rules WHERE account_id = ?',
        input.accountId
      )
    )?.m

    // The legacy columns are still NOT NULL, so they get a readable summary of the first
    // condition rather than being dropped. The schema stays loadable by older builds.
    const first = input.conditions[0]
    await tx.run(
      `INSERT INTO filter_rules (
         id, account_id, name, condition_field, condition_value, action_type,
         action_target_folder_id, sort_order, match_mode, conditions_json, actions_json
       ) VALUES (
         @id, @accountId, @name, @conditionField, @conditionValue, @actionType,
         @actionTargetFolderId, @sortOrder, @matchMode, @conditions, @actions
       )`,
      {
        id,
        accountId: input.accountId,
        name: input.name,
        conditionField: first?.field ?? 'subject',
        conditionValue: first?.value ?? '',
        actionType: input.actions[0]?.type ?? 'markRead',
        actionTargetFolderId: input.actions.find((a) => a.targetFolderId)?.targetFolderId ?? null,
        sortOrder: (maxSortOrder ?? -1) + 1,
        matchMode: input.matchMode,
        conditions: JSON.stringify(input.conditions),
        actions: JSON.stringify(input.actions)
      }
    )
  })
  return id
}

export async function updateFilterRule(
  db: SqlDb,
  ruleId: string,
  input: FilterRuleInput
): Promise<void> {
  const first = input.conditions[0]
  await db.run(
    `UPDATE filter_rules SET
       name = @name, match_mode = @matchMode, conditions_json = @conditions,
       actions_json = @actions, condition_field = @conditionField,
       condition_value = @conditionValue, action_type = @actionType,
       action_target_folder_id = @actionTargetFolderId
     WHERE id = @id`,
    {
      id: ruleId,
      name: input.name,
      matchMode: input.matchMode,
      conditions: JSON.stringify(input.conditions),
      actions: JSON.stringify(input.actions),
      conditionField: first?.field ?? 'subject',
      conditionValue: first?.value ?? '',
      actionType: input.actions[0]?.type ?? 'markRead',
      actionTargetFolderId: input.actions.find((a) => a.targetFolderId)?.targetFolderId ?? null
    }
  )
}

export async function deleteFilterRule(db: SqlDb, ruleId: string): Promise<void> {
  await db.run('DELETE FROM filter_rules WHERE id = ?', ruleId)
}

export async function setFilterRuleEnabled(
  db: SqlDb,
  ruleId: string,
  enabled: boolean
): Promise<void> {
  await db.run('UPDATE filter_rules SET enabled = ? WHERE id = ?', enabled ? 1 : 0, ruleId)
}

/** Writes the run order; the array lists rule ids highest priority first. */
export async function reorderFilterRules(
  db: SqlDb,
  accountId: string,
  ruleIds: string[]
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const [index, ruleId] of ruleIds.entries()) {
      await tx.run(
        'UPDATE filter_rules SET sort_order = ? WHERE id = ? AND account_id = ?',
        index,
        ruleId,
        accountId
      )
    }
  })
}

export async function getFilterRule(db: SqlDb, ruleId: string): Promise<FilterRule | undefined> {
  const row = await db.get<FilterRuleRow>('SELECT * FROM filter_rules WHERE id = ?', ruleId)
  return row ? toFilterRule(row) : undefined
}
