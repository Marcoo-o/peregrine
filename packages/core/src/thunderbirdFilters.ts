import type { FilterCondition, FilterConditionField, FilterOperator } from './types'

/**
 * Reads Thunderbird's `msgFilterRules.dat`.
 *
 * The file is a flat list of `key="value"` lines, one block per rule, in the order the rules
 * run. It has looked the same since the Netscape days and is the only place the rules live,
 * so parsing it is the whole of the import.
 */

export interface ImportableFilterRule {
  name: string
  enabled: boolean
  matchMode: 'all' | 'any'
  conditions: FilterCondition[]
  /** The folder a move action names, as a path. Empty when the rule does not move anything. */
  moveTarget: string
  actions: ('markRead' | 'flag' | 'delete' | 'stop')[]
  /** What was dropped, so the import can say so instead of silently changing a rule. */
  unsupported: string[]
}

/** Thunderbird's field names, as far as they have an equivalent here. */
const FIELDS: Record<string, FilterConditionField> = {
  from: 'from',
  to: 'to',
  cc: 'cc',
  'to or cc': 'to',
  subject: 'subject',
  body: 'body',
  size: 'sizeBytes'
}

/** Thunderbird's operator names. The negated ones have no counterpart for every field. */
const OPERATORS: Record<string, FilterOperator> = {
  contains: 'contains',
  "doesn't contain": 'notContains',
  is: 'equals',
  "isn't": 'equals',
  'begins with': 'startsWith',
  'ends with': 'endsWith',
  matches: 'regex',
  "doesn't match": 'regex',
  'is greater than': 'greaterThan',
  'is less than': 'lessThan'
}

/** Splits one `key="value"` line, undoing the backslash escapes inside the value. */
function parseLine(line: string): { key: string; value: string } | null {
  const match = /^([A-Za-z]+)="(.*)"$/.exec(line.trim())
  if (!match) return null
  return { key: match[1], value: match[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\') }
}

/**
 * Reads the condition string, which looks like `AND (from,contains,news@example.com)`.
 *
 * A value may itself contain a comma, so the split is on the first two only. `ALL` stands for
 * a rule without conditions, which matches every message; that is a real rule in Thunderbird
 * and becomes a rule with no conditions here, which the engine treats as matching nothing.
 * Reporting it as unsupported is the honest answer rather than importing a rule that would
 * quietly do nothing.
 */
function parseConditions(text: string): {
  matchMode: 'all' | 'any'
  conditions: FilterCondition[]
  unsupported: string[]
} {
  const unsupported: string[] = []
  const conditions: FilterCondition[] = []
  let matchMode: 'all' | 'any' = 'all'

  if (text.trim().toUpperCase() === 'ALL') {
    return { matchMode, conditions, unsupported: ['ALL'] }
  }

  const pattern = /\b(AND|OR)\s*\(([^)]*)\)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    // Thunderbird writes the same joiner in front of every term, so the last one read wins
    // and there is no mixed case to worry about.
    if (match[1] === 'OR') matchMode = 'any'

    const firstComma = match[2].indexOf(',')
    const secondComma = match[2].indexOf(',', firstComma + 1)
    if (firstComma === -1 || secondComma === -1) continue

    const rawField = match[2].slice(0, firstComma).trim().toLowerCase()
    const rawOperator = match[2].slice(firstComma + 1, secondComma).trim().toLowerCase()
    const value = match[2].slice(secondComma + 1)

    const field = FIELDS[rawField]
    const operator = OPERATORS[rawOperator]
    if (!field || !operator) {
      unsupported.push(`${rawField} ${rawOperator}`)
      continue
    }
    // "isn't" and "doesn't match" have no negated form here for anything but contains, and
    // importing them as their positive twin would invert what the rule does.
    if (rawOperator === "isn't" || rawOperator === "doesn't match") {
      unsupported.push(`${rawField} ${rawOperator}`)
      continue
    }
    conditions.push({ field, operator, value })
  }

  return { matchMode, conditions, unsupported }
}

/**
 * Pulls the folder out of the IMAP URL a move action carries.
 *
 * `imap://john%40example.com@mail.example.com/Rechnungen/2026` names the account in front
 * and the folder behind, and only the folder can be matched against anything here.
 */
export function folderPathFromImapUrl(url: string): string {
  const withoutScheme = url.replace(/^(imap|mailbox):\/\//i, '')
  const slash = withoutScheme.indexOf('/')
  if (slash === -1) return ''
  try {
    return decodeURIComponent(withoutScheme.slice(slash + 1))
  } catch {
    return withoutScheme.slice(slash + 1)
  }
}

export function parseThunderbirdFilters(text: string): ImportableFilterRule[] {
  const rules: ImportableFilterRule[] = []
  let current: ImportableFilterRule | null = null

  for (const line of text.split(/\r?\n/)) {
    const parsed = parseLine(line)
    if (!parsed) continue

    // A `name` line opens a rule. Everything before the first one is the file header.
    if (parsed.key === 'name') {
      if (current) rules.push(current)
      current = {
        name: parsed.value,
        enabled: true,
        matchMode: 'all',
        conditions: [],
        moveTarget: '',
        actions: [],
        unsupported: []
      }
      continue
    }
    if (!current) continue

    switch (parsed.key) {
      case 'enabled':
        current.enabled = parsed.value === 'yes'
        break
      case 'condition': {
        const result = parseConditions(parsed.value)
        current.matchMode = result.matchMode
        current.conditions = result.conditions
        current.unsupported.push(...result.unsupported)
        break
      }
      case 'action':
        switch (parsed.value) {
          case 'Mark read':
            current.actions.push('markRead')
            break
          case 'Mark flagged':
            current.actions.push('flag')
            break
          case 'Delete':
            current.actions.push('delete')
            break
          case 'Stop execution':
            current.actions.push('stop')
            break
          case 'Move to folder':
            // The folder arrives on the following actionValue line.
            break
          default:
            current.unsupported.push(parsed.value)
        }
        break
      case 'actionValue':
        // Only a move writes a folder; the other actions that carry a value are the ones
        // already recorded as unsupported, so their value is of no use either.
        if (/^(imap|mailbox):\/\//i.test(parsed.value)) {
          current.moveTarget = folderPathFromImapUrl(parsed.value)
        }
        break
    }
  }

  if (current) rules.push(current)
  return rules
}
