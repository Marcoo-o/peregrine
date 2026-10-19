import type { MailboxEntry } from '@peregrine/core/imapSession'
import type { SqlDb } from '@peregrine/core/sqlDb'
import { newId } from './ids'

export interface Folder {
  id: string
  accountId: string
  /** The path on the server, in the server's own spelling. */
  imapPath: string
  displayName: string
  /** The role the server names, such as `\Sent`, or null. */
  specialUse: string | null
}

interface FolderRow {
  id: string
  account_id: string
  imap_path: string
  display_name: string
  special_use: string | null
}

function toFolder(row: FolderRow): Folder {
  return {
    id: row.id,
    accountId: row.account_id,
    imapPath: row.imap_path,
    displayName: row.display_name,
    specialUse: row.special_use
  }
}

/** The inbox first, then the folders with a role, then the rest, each group by name. */
export async function listFolders(db: SqlDb, accountId: string): Promise<Folder[]> {
  const rows = await db.all<FolderRow>(
    `SELECT id, account_id, imap_path, display_name, special_use FROM folders WHERE account_id = ?
     ORDER BY CASE WHEN special_use = '\\Inbox' OR upper(imap_path) = 'INBOX' THEN 0
                   WHEN special_use IS NOT NULL THEN 1 ELSE 2 END,
              display_name COLLATE NOCASE`,
    accountId
  )
  return rows.map(toFolder)
}

export async function getFolder(db: SqlDb, id: string): Promise<Folder | undefined> {
  const row = await db.get<FolderRow>(
    'SELECT id, account_id, imap_path, display_name, special_use FROM folders WHERE id = ?',
    id
  )
  return row ? toFolder(row) : undefined
}

/** The folder of an account that has a role, such as `\Trash`, or undefined when the server names none. */
export async function getFolderBySpecialUse(
  db: SqlDb,
  accountId: string,
  specialUse: string
): Promise<Folder | undefined> {
  const row = await db.get<FolderRow>(
    `SELECT id, account_id, imap_path, display_name, special_use FROM folders
     WHERE account_id = ? AND special_use = ? ORDER BY display_name LIMIT 1`,
    accountId,
    specialUse
  )
  return row ? toFolder(row) : undefined
}

/**
 * Makes the folders of an account the ones the server lists.
 *
 * A folder that is already known keeps its id, which is the point of having one: a queued action
 * and the messages of the folder name it, and a folder that is listed again after a sync is the
 * same folder. A new one gets an id. One the server no longer lists goes, with its messages, and an
 * action in the queue that names it finds nothing and is dropped, which is what the queue does with
 * a folder that is gone.
 */
export async function syncFolders(
  db: SqlDb,
  accountId: string,
  entries: MailboxEntry[],
  makeId: () => string = newId
): Promise<Folder[]> {
  await db.transaction(async (tx) => {
    const known = await tx.all<FolderRow>(
      'SELECT id, account_id, imap_path, display_name, special_use FROM folders WHERE account_id = ?',
      accountId
    )
    const byPath = new Map(known.map((row) => [row.imap_path, row]))
    const listed = new Set<string>()
    for (const entry of entries) {
      // A folder that cannot be selected, such as the parent of others on some servers, is no folder
      // for mail and is not kept.
      if (entry.flags.some((flag) => flag.toLowerCase() === '\\noselect')) continue
      listed.add(entry.path)
      const existing = byPath.get(entry.path)
      if (existing) {
        await tx.run(
          'UPDATE folders SET display_name = ?, special_use = ? WHERE id = ?',
          entry.name,
          entry.specialUse,
          existing.id
        )
      } else {
        await tx.run(
          'INSERT INTO folders (id, account_id, imap_path, display_name, special_use) VALUES (?, ?, ?, ?, ?)',
          makeId(),
          accountId,
          entry.path,
          entry.name,
          entry.specialUse
        )
      }
    }
    for (const row of known) {
      if (listed.has(row.imap_path)) continue
      await tx.run('DELETE FROM messages WHERE folder_id = ?', row.id)
      await tx.run('DELETE FROM folders WHERE id = ?', row.id)
    }
  })
  return listFolders(db, accountId)
}
