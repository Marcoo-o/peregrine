import type { ImapSession } from '@peregrine/core/imapSession'
import type { SqlDb } from '@peregrine/core/sqlDb'
import type { Folder } from './folders'
import { saveMessages } from './messages'

/** How many of the newest messages the prototype fetches. A real sync is a later stage. */
export const NEWEST = 50

/**
 * Fetches the headers of the newest messages of one folder and stores them.
 *
 * The range is decided once the folder is open and its UIDNEXT is known, which is what
 * `syncFetch` is for. An empty folder fetches nothing. Nothing is written back to the server.
 */
export async function syncFolder(session: ImapSession, db: SqlDb, folder: Folder): Promise<number> {
  const result = await session.syncFetch(folder.imapPath, ({ uidNext }) => {
    const first = Math.max(1, uidNext - NEWEST)
    return `${first}:*`
  })
  await saveMessages(db, folder, result.messages)
  return result.messages.length
}
