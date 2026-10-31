import type { ImapSession } from '@peregrine/core/imapSession'
import type { SqlDb } from '@peregrine/core/sqlDb'
import type { ComposeInput } from '@peregrine/core/types'
import { getAccount } from './accounts'
import type { FileAccess } from './files'
import type { PendingSaveDraftPayload } from '@peregrine/core/pendingActions'
import { getFolder, getFolderBySpecialUse, type Folder } from './folders'
import { deleteMessages } from './messages'
import { composeFromInput } from './send'
import { t } from './i18n'

/** Where a draft is kept: the account's Drafts folder, or nothing when the account has none. */
export const draftsFolderOf = (db: SqlDb, accountId: string): Promise<Folder | undefined> =>
  getFolderBySpecialUse(db, accountId, '\\Drafts')

/**
 * Keeps a message that is not finished on the server, in the Drafts folder, marked as a draft and as read, as the
 * desktop does. Returns the folder it is in and the UID the server gave it, which is what the next save replaces, or
 * null for the UID when the server does not say.
 *
 * Its refusals are in the words of the screen, since the compose screen shows them as they are. It refuses where keeping the
 * message would keep something other than what was written: a draft that was meant to be encrypted does not sit on the server
 * in the clear, and when it cannot be encrypted it is not kept.
 */
export async function saveDraft(
  db: SqlDb,
  files: FileAccess | undefined,
  imap: ImapSession,
  input: ComposeInput
): Promise<{ folder: Folder; uid: number | null }> {
  const account = await getAccount(db, input.accountId)
  if (!account) throw new Error(t('Das Konto, für das die Nachricht geschrieben wurde, gibt es nicht mehr.'))
  if (!account.emailAddress) throw new Error(t('Zu diesem Konto gibt es keine Absenderadresse.'))
  const folder = await draftsFolderOf(db, input.accountId)
  if (!folder) throw new Error(t('Dieses Konto hat keinen Ordner für Entwürfe.'))
  // A draft is written with its blind copy, which is all it has to remember who it was for.
  const composed = await composeFromInput(db, account, input, files, { draft: true })
  return { folder, uid: await imap.appendMessage(folder.imapPath, composed.source, ['\\Draft', '\\Seen']) }
}

/**
 * Keeps a draft that waited in the queue, once there is a connection: the new revision is appended first, and the one that
 * it replaces is deleted after, as for a draft that is kept at once, so that a connection that ends in between leaves
 * two drafts and not none. Returns where the new one is.
 */
export async function keepQueuedDraft(
  db: SqlDb,
  files: FileAccess | undefined,
  imap: ImapSession,
  payload: PendingSaveDraftPayload
): Promise<{ folder: Folder; uid: number | null }> {
  const kept = await saveDraft(db, files, imap, payload.input)
  if (payload.replace) {
    const before = await getFolder(db, payload.replace.folderId)
    if (before) {
      await imap.deleteMessages(before.imapPath, [payload.replace.uid])
      await deleteMessages(db, before.id, [payload.replace.uid])
    }
  }
  return kept
}
