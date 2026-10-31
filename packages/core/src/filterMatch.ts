import type { FilterCondition, FilterRule } from './types'

/** The message shape a rule is evaluated against. */
export interface FilterableMessage {
  subject: string
  from: { name: string; address: string }[]
  to: { name: string; address: string }[]
  cc: { name: string; address: string }[]
  textBody: string | null
  sizeBytes: number
  hasAttachments: boolean
}

function addressText(addresses: { name: string; address: string }[]): string {
  return addresses.map((a) => `${a.name} ${a.address}`).join(' ')
}

/** Exported for tests: the value a condition is matched against, per field. */
export function fieldValue(
  field: FilterCondition['field'],
  message: FilterableMessage
): string | number | boolean | null {
  switch (field) {
    case 'subject':
      return message.subject
    case 'from':
      return addressText(message.from)
    case 'to':
      return addressText(message.to)
    case 'cc':
      return addressText(message.cc)
    case 'body':
      // Bodies are only cached once a message has been opened; an absent body must not match
      // rather than count as an empty string that "contains" nothing.
      return message.textBody
    case 'sizeBytes':
      return message.sizeBytes
    case 'hasAttachment':
      return message.hasAttachments
    default:
      return null
  }
}

/** Exported for tests: evaluates a single condition. */
export function matchesCondition(condition: FilterCondition, message: FilterableMessage): boolean {
  const value = fieldValue(condition.field, message)

  if (typeof value === 'boolean') {
    if (condition.operator === 'isFalse') return value === false
    return value === true
  }

  if (typeof value === 'number') {
    const threshold = Number(condition.value)
    if (!Number.isFinite(threshold)) return false
    if (condition.operator === 'lessThan') return value < threshold
    if (condition.operator === 'greaterThan') return value > threshold
    return value === threshold
  }

  if (value == null) return false

  const haystack = value.toLowerCase()
  const needle = condition.value.toLowerCase()

  switch (condition.operator) {
    case 'notContains':
      return !haystack.includes(needle)
    case 'equals':
      return haystack === needle
    case 'startsWith':
      return haystack.startsWith(needle)
    case 'endsWith':
      return haystack.endsWith(needle)
    case 'regex':
      try {
        return new RegExp(condition.value, 'i').test(value)
      } catch {
        // A rule with a broken pattern must not take the whole filter run down.
        return false
      }
    default:
      return haystack.includes(needle)
  }
}

/** Exported for tests: combines the rule's conditions per its match mode. */
export function matchesRule(rule: FilterRule, message: FilterableMessage): boolean {
  if (rule.conditions.length === 0) return false
  return rule.matchMode === 'any'
    ? rule.conditions.some((condition) => matchesCondition(condition, message))
    : rule.conditions.every((condition) => matchesCondition(condition, message))
}
