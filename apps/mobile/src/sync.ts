import type { ImapSession } from '@peregrine/core/imapSession'
import type { SqlDb } from '@peregrine/core/sqlDb'
import { cachedBounds, clearMessages, knownUidValidity, reconcile, rememberUidValidity, resetFolder, type FolderReset } from './folderChanges'
import type { Folder } from './folders'
import { applyRules, isInboxFolder, listRules } from './filterRules'
import { saveMessages } from './messages'

/** How many of the newest messages a folder that was never synced fetches. */
export const NEWEST = 50

/** How many older messages one load fetches. */
export const PAGE = 50

/**
 * How far the UIDs of a folder may have run on, since the newest message the phone has, before it does not catch up and starts the
 * folder anew: the messages in between would be a hole that loading older ones never fills.
 */
const MAX_GAP = 500

interface Synced {
  fetched: number
  /** Every UID the server has in the folder, with its flags. */
  onServer: { uid: number; flags: string[] }[]
}

async function sync(session: ImapSession, db: SqlDb, folder: Folder, onReset?: (reset: FolderReset) => void): Promise<Synced> {
  const result = await session.syncFetch(folder.imapPath, async ({ uidValidity, uidNext }) => {
    const known = await knownUidValidity(db, folder.id)
    if (known !== null && known !== uidValidity.toString()) onReset?.(await resetFolder(db, folder))
    await rememberUidValidity(db, folder.id, uidValidity)
    let bounds = await cachedBounds(db, folder.id)
    if (bounds && uidNext - bounds.max > MAX_GAP) {
      await clearMessages(db, folder.id)
      bounds = null
    }
    return `${bounds ? bounds.max + 1 : Math.max(1, uidNext - NEWEST)}:*`
  })
  await saveMessages(db, folder, result.messages)
  await reconcile(db, folder, result.flags)
  // What arrives in an inbox is sorted by the rules of its account. A rule that cannot be done does not make the sync fail.
  if (isInboxFolder(folder) && result.messages.length > 0) {
    try {
      await applyRules(session, db, folder, result.messages, await listRules(db, folder.accountId))
    } catch {
      // The mail is there; sorting it is tried again for the next that arrives.
    }
  }
  return { fetched: result.messages.length, onServer: result.flags }
}

/**
 * Brings a folder up to date: fetches the headers of what is new since the newest message the phone has (the newest 50 of a folder that
 * it has none of), and from the list of every message of the folder that the server gives takes out what is gone and updates the flags of
 * what is there. `syncFetch` knows the folder's UIDVALIDITY when it decides the range, and a folder that has been numbered anew is
 * forgotten, with the changes that waited for it, and fetched again (`onReset` is told). Nothing is written back to the server.
 */
export async function syncFolder(
  session: ImapSession,
  db: SqlDb,
  folder: Folder,
  onReset?: (reset: FolderReset) => void
): Promise<number> {
  return (await sync(session, db, folder, onReset)).fetched
}

/**
 * Loads the next page of older messages of a folder: after a sync, which also says which UIDs the server has, the highest 50 below the
 * oldest message the phone has. They are taken from that list and not counted down from a UID, so that a folder whose messages were
 * deleted here and there still gives a full page. Returns how many were loaded; none when there is nothing older.
 */
export async function loadOlder(session: ImapSession, db: SqlDb, folder: Folder, onReset?: (reset: FolderReset) => void): Promise<number> {
  const { onServer } = await sync(session, db, folder, onReset)
  const bounds = await cachedBounds(db, folder.id)
  const have = new Set((await db.all<{ uid: number }>('SELECT uid FROM messages WHERE folder_id = ?', folder.id)).map((row) => row.uid))
  const older = onServer
    .map((message) => message.uid)
    .filter((uid) => !have.has(uid) && (bounds === null || uid < bounds.min))
    .sort((a, b) => b - a)
    .slice(0, PAGE)
  if (older.length === 0) return 0
  const messages = await session.fetchMessages(folder.imapPath, older)
  await saveMessages(db, folder, messages)
  return messages.length
}
