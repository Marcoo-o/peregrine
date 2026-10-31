import type { FetchedMessage, ImapSession } from '@peregrine/core/imapSession'
import { matchesRule, type FilterableMessage } from '@peregrine/core/filterMatch'
import type { SqlDb } from '@peregrine/core/sqlDb'
import type {
  FilterAction,
  FilterActionType,
  FilterCondition,
  FilterConditionField,
  FilterMatchMode,
  FilterOperator,
  FilterRule,
  FilterRuleInput
} from '@peregrine/core/types'
import { FLAGGED, SEEN } from './flags'
import { getFolder, getFolderBySpecialUse, type Folder } from './folders'
import { msg, t } from './i18n'

/**
 * The rules that sort the mail of an account as it arrives, as the desktop has them: when they match (all of the conditions or any of them), and what is
 * done with the message. They run in the order the user put them in, every rule that matches applies, and a `stop` ends the chain. The matching is the
 * desktop's (`@peregrine/core/filterMatch`); what is here is keeping the rules, checking them, and doing what they say.
 */

export const FIELDS: ReadonlyArray<{ field: FilterConditionField; label: string; kind: 'text' | 'size' | 'flag' }> = [
  { field: 'from', label: msg('Absender'), kind: 'text' },
  { field: 'to', label: msg('An'), kind: 'text' },
  { field: 'cc', label: msg('Kopie'), kind: 'text' },
  { field: 'subject', label: msg('Betreff'), kind: 'text' },
  { field: 'body', label: msg('Text'), kind: 'text' },
  { field: 'sizeBytes', label: msg('Größe'), kind: 'size' },
  { field: 'hasAttachment', label: msg('Anhang'), kind: 'flag' }
]

const TEXT_OPERATORS: ReadonlyArray<{ operator: FilterOperator; label: string }> = [
  { operator: 'contains', label: msg('enthält') },
  { operator: 'notContains', label: msg('enthält nicht') },
  { operator: 'equals', label: msg('ist') },
  { operator: 'startsWith', label: msg('beginnt mit') },
  { operator: 'endsWith', label: msg('endet mit') },
  { operator: 'regex', label: msg('passt auf Muster') }
]
const SIZE_OPERATORS: ReadonlyArray<{ operator: FilterOperator; label: string }> = [
  { operator: 'greaterThan', label: msg('größer als') },
  { operator: 'lessThan', label: msg('kleiner als') },
  { operator: 'equals', label: msg('genau') }
]
const FLAG_OPERATORS: ReadonlyArray<{ operator: FilterOperator; label: string }> = [
  { operator: 'isTrue', label: msg('ist vorhanden') },
  { operator: 'isFalse', label: msg('fehlt') }
]

/** The ways a condition can compare, for the field it is about. */
export function operatorsFor(field: FilterConditionField): ReadonlyArray<{ operator: FilterOperator; label: string }> {
  const kind = FIELDS.find((candidate) => candidate.field === field)?.kind
  return kind === 'size' ? SIZE_OPERATORS : kind === 'flag' ? FLAG_OPERATORS : TEXT_OPERATORS
}

/** The actions, with their words. `move` needs a folder to move to. */
export const ACTIONS: ReadonlyArray<{ type: FilterActionType; label: string }> = [
  { type: 'move', label: msg('Verschieben nach') },
  { type: 'markRead', label: msg('Als gelesen markieren') },
  { type: 'markUnread', label: msg('Als ungelesen markieren') },
  { type: 'flag', label: msg('Markieren') },
  { type: 'delete', label: msg('Löschen') },
  { type: 'stop', label: msg('Keine weiteren Regeln anwenden') }
]

export const MATCH_MODES: ReadonlyArray<{ mode: FilterMatchMode; label: string }> = [
  { mode: 'all', label: msg('Alle Bedingungen treffen zu') },
  { mode: 'any', label: msg('Eine Bedingung trifft zu') }
]

/** A condition as it starts when it is added. */
export const NEW_CONDITION: FilterCondition = { field: 'from', operator: 'contains', value: '' }
export const NEW_ACTION: FilterAction = { type: 'markRead' }

interface RuleRow {
  id: string
  account_id: string
  name: string
  match_mode: string
  conditions_json: string
  actions_json: string
  enabled: number
  sort_order: number
}

function parse<T>(raw: string, fallback: T): T {
  try {
    const value = JSON.parse(raw) as unknown
    return Array.isArray(value) ? (value as unknown as T) : fallback
  } catch {
    return fallback
  }
}

function toRule(row: RuleRow): FilterRule {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    matchMode: row.match_mode === 'any' ? 'any' : 'all',
    conditions: parse<FilterCondition[]>(row.conditions_json, []),
    actions: parse<FilterAction[]>(row.actions_json, []),
    enabled: row.enabled === 1,
    priority: row.sort_order
  }
}

/** The rules of an account, in the order they run in. */
export async function listRules(db: SqlDb, accountId: string): Promise<FilterRule[]> {
  const rows = await db.all<RuleRow>('SELECT * FROM filter_rules WHERE account_id = ? ORDER BY sort_order, rowid', accountId)
  return rows.map(toRule)
}

export async function getRule(db: SqlDb, id: string): Promise<FilterRule | undefined> {
  const row = await db.get<RuleRow>('SELECT * FROM filter_rules WHERE id = ?', id)
  return row ? toRule(row) : undefined
}

/** What is wrong with a rule that cannot be kept, in a line, or null. */
export function ruleProblem(input: Pick<FilterRuleInput, 'name' | 'conditions' | 'actions'>): string | null {
  if (input.name.trim() === '') return t('Die Regel braucht einen Namen.')
  if (input.conditions.length === 0) return t('Die Regel braucht mindestens eine Bedingung.')
  for (const condition of input.conditions) {
    const kind = FIELDS.find((candidate) => candidate.field === condition.field)?.kind
    if (kind === 'flag') continue
    if (condition.value.trim() === '') return t('Jede Bedingung braucht einen Wert.')
    if (kind === 'size' && !Number.isFinite(Number(condition.value))) return t('Die Größe muss eine Zahl sein (in Byte).')
    if (condition.operator === 'regex') {
      try {
        new RegExp(condition.value, 'i')
      } catch {
        return t('Das Muster „{pattern}“ ist keins.', { pattern: condition.value })
      }
    }
  }
  if (input.actions.length === 0) return t('Die Regel braucht mindestens eine Aktion.')
  if (input.actions.some((action) => action.type === 'move' && !action.targetFolderId)) return t('Zum Verschieben braucht es einen Ordner.')
  return null
}

/** Keeps a rule: a new one at the end when `id` is not given, else the change of that one. */
export async function saveRule(db: SqlDb, input: FilterRuleInput, id?: string): Promise<{ saved: FilterRule } | { problem: string }> {
  const problem = ruleProblem(input)
  if (problem) return { problem }
  const values = [
    input.name.trim(),
    input.matchMode,
    JSON.stringify(input.conditions.map((condition) => ({ ...condition, value: condition.value.trim() }))),
    JSON.stringify(input.actions)
  ]
  if (id && (await getRule(db, id))) {
    await db.run('UPDATE filter_rules SET name = ?, match_mode = ?, conditions_json = ?, actions_json = ? WHERE id = ?', ...values, id)
    return { saved: (await getRule(db, id)) as FilterRule }
  }
  const made = id ?? `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const last = await db.get<{ m: number | null }>('SELECT MAX(sort_order) AS m FROM filter_rules WHERE account_id = ?', input.accountId)
  await db.run(
    `INSERT INTO filter_rules (id, account_id, name, match_mode, conditions_json, actions_json, enabled, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    made,
    input.accountId,
    ...values,
    (last?.m ?? -1) + 1
  )
  return { saved: (await getRule(db, made)) as FilterRule }
}

export async function removeRule(db: SqlDb, id: string): Promise<void> {
  await db.run('DELETE FROM filter_rules WHERE id = ?', id)
}

export async function setRuleEnabled(db: SqlDb, id: string, enabled: boolean): Promise<void> {
  await db.run('UPDATE filter_rules SET enabled = ? WHERE id = ?', enabled ? 1 : 0, id)
}

/** Moves a rule one place earlier or later among the rules of its account; the order is what decides which runs first. */
export async function moveRule(db: SqlDb, id: string, direction: -1 | 1): Promise<void> {
  const rule = await getRule(db, id)
  if (!rule) return
  const rules = await listRules(db, rule.accountId)
  const at = rules.findIndex((candidate) => candidate.id === id)
  const to = at + direction
  if (to < 0 || to >= rules.length) return
  const order = rules.map((candidate) => candidate.id)
  ;[order[at], order[to]] = [order[to], order[at]]
  await db.transaction(async (tx) => {
    for (let place = 0; place < order.length; place++) await tx.run('UPDATE filter_rules SET sort_order = ? WHERE id = ?', place, order[place])
  })
}

/** A line about a rule for a list: how many conditions and what is done. */
export function ruleSummary(rule: FilterRule, folderName: (id: string) => string | undefined): string {
  const done = rule.actions.map((action) => {
    const label = t(ACTIONS.find((candidate) => candidate.type === action.type)?.label ?? action.type)
    if (action.type !== 'move') return label
    return `${label} ${folderName(action.targetFolderId ?? '') ?? '?'}`
  })
  return done.join(', ')
}

/** What a rule looks at of a message that was fetched. The text is not fetched with the headers, so a condition on it does not match. */
export function filterable(message: FetchedMessage): FilterableMessage {
  const people = (list: Array<{ name?: string; address?: string }> | undefined) => (list ?? []).map((a) => ({ name: a.name ?? '', address: a.address ?? '' }))
  return {
    subject: message.envelope.subject ?? '',
    from: people(message.envelope.from),
    to: people(message.envelope.to),
    cc: people(message.envelope.cc),
    textBody: null,
    sizeBytes: message.size,
    hasAttachments: message.hasAttachment
  }
}

/**
 * What the rules do with a message, in order: every rule that is on and matches applies, in the order of the list, until one says stop or one
 * moves or deletes the message, which then is no longer where the rest would act on it.
 */
export function actionsFor(rules: FilterRule[], message: FilterableMessage): FilterAction[] {
  const done: FilterAction[] = []
  for (const rule of rules) {
    if (!rule.enabled || !matchesRule(rule, message)) continue
    for (const action of rule.actions) {
      if (action.type === 'stop') return done
      done.push(action)
      if (action.type === 'move' || action.type === 'delete') return done
    }
  }
  return done
}

async function changeLocalFlags(db: SqlDb, folderId: string, uid: number, change: (flags: string[]) => string[]): Promise<void> {
  const row = await db.get<{ flags: string }>('SELECT flags FROM messages WHERE folder_id = ? AND uid = ?', folderId, uid)
  if (!row) return
  await db.run('UPDATE messages SET flags = ? WHERE folder_id = ? AND uid = ?', JSON.stringify(change(parse<string[]>(row.flags, []))), folderId, uid)
}

/** Does one action to a message on the server and in the cache. Whether the message is gone from the folder afterwards. */
async function perform(session: ImapSession, db: SqlDb, folder: Folder, uid: number, action: FilterAction): Promise<boolean> {
  switch (action.type) {
    case 'markRead':
      await session.addFlags(folder.imapPath, uid, [SEEN])
      await changeLocalFlags(db, folder.id, uid, (flags) => (flags.includes(SEEN) ? flags : [...flags, SEEN]))
      return false
    case 'markUnread':
      await session.removeFlags(folder.imapPath, uid, [SEEN])
      await changeLocalFlags(db, folder.id, uid, (flags) => flags.filter((flag) => flag !== SEEN))
      return false
    case 'flag':
      await session.addFlags(folder.imapPath, uid, [FLAGGED])
      await changeLocalFlags(db, folder.id, uid, (flags) => (flags.includes(FLAGGED) ? flags : [...flags, FLAGGED]))
      return false
    case 'delete': {
      // Into the trash, as deleting is anywhere else, and for good only where there is none.
      const trash = await getFolderBySpecialUse(db, folder.accountId, '\\Trash')
      if (trash && trash.id !== folder.id) await session.moveMessages(folder.imapPath, trash.imapPath, [uid])
      else await session.deleteMessages(folder.imapPath, [uid])
      await db.run('DELETE FROM messages WHERE folder_id = ? AND uid = ?', folder.id, uid)
      return true
    }
    case 'move': {
      const target = action.targetFolderId ? await getFolder(db, action.targetFolderId) : undefined
      if (!target || target.id === folder.id) return false
      await session.moveMessages(folder.imapPath, target.imapPath, [uid])
      await db.run('DELETE FROM messages WHERE folder_id = ? AND uid = ?', folder.id, uid)
      return true
    }
    case 'stop':
      return false
  }
}

export interface FilterRun {
  /** How many messages a rule acted on. */
  matched: number
  /** How many actions could not be done, with the reason of the first. */
  failed: number
  firstProblem?: string
}

/**
 * Runs the rules of an account over messages that were fetched from one of its folders. An action that does not go through is counted and does not
 * keep the others from being done: a rule that cannot move a message to a folder that is gone must not stop the rest of the mail from being sorted.
 */
export async function applyRules(
  session: ImapSession,
  db: SqlDb,
  folder: Folder,
  messages: FetchedMessage[],
  rules: FilterRule[]
): Promise<FilterRun> {
  const run: FilterRun = { matched: 0, failed: 0 }
  const active = rules.filter((rule) => rule.enabled)
  if (active.length === 0) return run
  for (const message of messages) {
    const actions = actionsFor(active, filterable(message))
    if (actions.length === 0) continue
    run.matched += 1
    for (const action of actions) {
      try {
        if (await perform(session, db, folder, message.uid, action)) break
      } catch (error) {
        run.failed += 1
        run.firstProblem ??= error instanceof Error ? error.message : String(error)
      }
    }
  }
  return run
}

/** Whether a folder is an inbox: the server says so, or it is called INBOX, which every server has. Rules sort what arrives there and nowhere else. */
export const isInboxFolder = (folder: Pick<Folder, 'imapPath' | 'specialUse'>): boolean =>
  folder.specialUse === '\\Inbox' || folder.imapPath.toUpperCase() === 'INBOX'
