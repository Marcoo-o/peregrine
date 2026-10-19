import type { SqlDb } from '../db/sqlDb'
import type { FilterCondition, FilterRule } from '@peregrine/core/types'
import { listFilterRules } from '../db/repositories/filterRulesRepo'
import { getFolderById } from '../db/repositories/foldersRepo'
import {
  deleteMessages,
  getMessageByUid,
  setMessagesFlagged,
  setMessagesRead
} from '../db/repositories/messagesRepo'
import type { ImapSession } from '@peregrine/core/imapSession'
import type { NewMessageRef } from '../imap/syncEngine'

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

/**
 * Rules run in priority order and every matching rule applies, unlike the previous "first
 * match wins" behaviour. A rule carrying a 'stop' action ends the chain for that message,
 * and a message that was moved or deleted leaves the chain too. Its UID no longer exists
 * in the source folder.
 */
export async function applyFilterRules(
  db: SqlDb,
  accountId: string,
  folderId: string,
  imap: ImapSession,
  newMessages: NewMessageRef[],
  options?: { onlyRuleId?: string }
): Promise<number> {
  if (newMessages.length === 0) return 0
  const rules = (await listFilterRules(db, accountId)).filter(
    (rule) => rule.enabled && (!options?.onlyRuleId || rule.id === options.onlyRuleId)
  )
  if (rules.length === 0) return 0

  const sourceFolder = await getFolderById(db, folderId)
  if (!sourceFolder) return 0

  let matchedCount = 0

  for (const ref of newMessages) {
    const detail = await getMessageByUid(db, folderId, ref.uid)
    if (!detail) continue

    const message: FilterableMessage = {
      subject: detail.subject,
      from: detail.from,
      to: detail.to,
      cc: detail.cc,
      textBody: detail.textBody,
      sizeBytes: 0,
      hasAttachments: detail.attachments.length > 0
    }

    let removed = false
    let matchedAny = false

    for (const rule of rules) {
      if (removed) break
      if (!matchesRule(rule, message)) continue
      matchedAny = true

      let stop = false
      for (const action of rule.actions) {
        try {
          switch (action.type) {
            case 'markRead':
              await imap.setFlags(sourceFolder.imapPath, ref.uid, ['\\Seen'])
              await setMessagesRead(db, folderId, [ref.uid], true)
              break
            case 'markUnread':
              await imap.setFlags(sourceFolder.imapPath, ref.uid, [])
              await setMessagesRead(db, folderId, [ref.uid], false)
              break
            case 'flag':
              await imap.addFlags(sourceFolder.imapPath, ref.uid, ['\\Flagged'])
              await setMessagesFlagged(db, folderId, [ref.uid], true)
              break
            case 'delete':
              await imap.deleteMessages(sourceFolder.imapPath, [ref.uid])
              await deleteMessages(db, folderId, [ref.uid])
              removed = true
              break
            case 'move': {
              if (!action.targetFolderId) break
              const targetFolder = await getFolderById(db, action.targetFolderId)
              if (!targetFolder) break
              await imap.moveMessages(sourceFolder.imapPath, targetFolder.imapPath, [ref.uid])
              await deleteMessages(db, folderId, [ref.uid])
              removed = true
              break
            }
            case 'stop':
              stop = true
              break
          }
        } catch (err) {
          console.error(
            'filter rule action failed:',
            rule.name,
            err instanceof Error ? err.message : err
          )
        }
        if (removed) break
      }
      if (stop) break
    }

    if (matchedAny) matchedCount += 1
  }

  return matchedCount
}
