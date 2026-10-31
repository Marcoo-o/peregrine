import type { SqlDb } from '../db/sqlDb'
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

export { fieldValue, matchesCondition, matchesRule, type FilterableMessage } from '@peregrine/core/filterMatch'
import { matchesRule, type FilterableMessage } from '@peregrine/core/filterMatch'

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
