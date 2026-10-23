import type { ImapSession } from '@peregrine/core/imapSession'
import type { SqlDb } from '@peregrine/core/sqlDb'
import type { ComposeInput } from '@peregrine/core/types'
import { getAccount } from './accounts'
import type { FileAccess } from './files'
import { getFolderBySpecialUse, type Folder } from './folders'
import { composeFromInput } from './send'

/** Where a draft is kept: the account's Drafts folder, or nothing when the account has none. */
export const draftsFolderOf = (db: SqlDb, accountId: string): Promise<Folder | undefined> =>
  getFolderBySpecialUse(db, accountId, '\\Drafts')

/**
 * Keeps a message that is not finished on the server, in the Drafts folder, marked as a draft and as read, as the
 * desktop does. Returns the folder it is in and the UID the server gave it, which is what the next save replaces, or
 * null for the UID when the server does not say.
 *
 * Its refusals are in the words of the screen, since the compose screen shows them as they are. It refuses where keeping the message would keep something other than what was written: the
 * phone cannot encrypt or sign yet, and a draft that was meant to be would sit on the server in the clear.
 */
export async function saveDraft(
  db: SqlDb,
  files: FileAccess | undefined,
  imap: ImapSession,
  input: ComposeInput
): Promise<{ folder: Folder; uid: number | null }> {
  const account = await getAccount(db, input.accountId)
  if (!account) throw new Error('Das Konto, für das die Nachricht geschrieben wurde, gibt es nicht mehr.')
  if (!account.emailAddress) throw new Error('Zu diesem Konto gibt es keine Absenderadresse.')
  if (input.encrypt || input.sign) throw new Error('Verschlüsseln und Signieren gibt es auf dem Handy noch nicht.')
  const folder = await draftsFolderOf(db, input.accountId)
  if (!folder) throw new Error('Dieses Konto hat keinen Ordner für Entwürfe.')
  // A draft is written with its blind copy, which is all it has to remember who it was for.
  const composed = await composeFromInput(account, input, files, { draft: true })
  return { folder, uid: await imap.appendMessage(folder.imapPath, composed.source, ['\\Draft', '\\Seen']) }
}
