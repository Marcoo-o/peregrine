import type { ImapSession } from '@peregrine/core/imapSession'
import type { SqlDb } from '@peregrine/core/sqlDb'
import { dropGone, knownUidValidity, rememberUidValidity, resetFolder, type FolderReset } from './folderChanges'
import type { Folder } from './folders'
import { saveMessages } from './messages'

/** How many of the newest messages the prototype fetches. A real sync is a later stage. */
export const NEWEST = 50

/**
 * Fetches the headers of the newest messages of one folder and stores them.
 *
 * The range is decided once the folder is open and its UIDNEXT is known, which is what
 * `syncFetch` is for, and that is also where its UIDVALIDITY is known. A folder whose UIDVALIDITY is not the one it had has
 * been numbered anew by the server, and what the phone kept of it means nothing now: it is forgotten, with the changes that
 * waited for it, and fetched again (`onReset` is told). What the server did not give of the range that was asked for is
 * taken out of the list: those messages are gone. An empty folder fetches nothing. Nothing is written back to the server.
 */
export async function syncFolder(
  session: ImapSession,
  db: SqlDb,
  folder: Folder,
  onReset?: (reset: FolderReset) => void
): Promise<number> {
  let first = 1
  const result = await session.syncFetch(folder.imapPath, async ({ uidValidity, uidNext }) => {
    first = Math.max(1, uidNext - NEWEST)
    const known = await knownUidValidity(db, folder.id)
    if (known !== null && known !== uidValidity.toString()) onReset?.(await resetFolder(db, folder))
    await rememberUidValidity(db, folder.id, uidValidity)
    return `${first}:*`
  })
  await saveMessages(db, folder, result.messages)
  await dropGone(db, folder.id, first, result.messages.map((message) => message.uid))
  return result.messages.length
}
