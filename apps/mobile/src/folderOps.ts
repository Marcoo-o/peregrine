import type { SqlDb } from '@peregrine/core/sqlDb'
import type { Folder } from './folders'
import { SEEN } from './flags'
import { isInbox } from './unified'
import { t } from './i18n'

/** Whether a folder can be renamed or deleted: not the inbox and not one with a job, which every "archive" and "trash" action depends on. */
export function isChangeable(folder: Folder): boolean {
  return folder.specialUse === null && !isInbox(folder)
}

/** Whether a folder can be emptied: the trash and the junk folder, where what is in it is wanted gone. */
export function isEmptiable(folder: Folder): boolean {
  return folder.specialUse === '\\Trash' || folder.specialUse === '\\Junk'
}

/** The longest name taken for a folder. Servers differ in what they take, and a name this long is a mistake anyway. */
const MAX_NAME = 100

/**
 * Why a name cannot be given to a folder, or null. It is checked here because the server's answer to a bad name is "NO"
 * and little else. A name does not hold the delimiter (it would make a folder inside another), nor the characters that
 * IMAP reads as wildcards, and is not there already among the folders it sits with; the comparison is without regard
 * to case, as most servers do it.
 */
export function folderNameProblem(name: string, delimiter: string, siblings: string[], own?: string): string | null {
  const text = name.trim()
  if (text === '') return t('Der Ordner braucht einen Namen.')
  if (text.length > MAX_NAME) return t('Der Name darf höchstens {MAX_NAME} Zeichen haben.', { MAX_NAME })
  if (text === '.' || text === '..') return t('Dieser Name ist nicht erlaubt.')
  if (delimiter !== '' && text.includes(delimiter)) return t('Der Name darf kein „{delimiter}“ enthalten, das trennt Ordner voneinander.', { delimiter })
  if (/[*%\\]|[\u0000-\u001f]/.test(text)) return t('Der Name enthält Zeichen, die ein Mailserver nicht annimmt.')
  const taken = siblings.some((sibling) => sibling.toLowerCase() === text.toLowerCase() && sibling !== own)
  if (taken) return t('Einen Ordner mit diesem Namen gibt es dort schon.')
  return null
}

/** The path of a folder with a name, inside another or at the top. */
export function pathWithName(parentPath: string | null, name: string, delimiter: string): string {
  return parentPath === null ? name.trim() : `${parentPath}${delimiter}${name.trim()}`
}

/** The path of a folder after it was given another name: the same place, the last segment changed. */
export function renamedPath(path: string, name: string, delimiter: string): string {
  const cut = delimiter === '' ? -1 : path.lastIndexOf(delimiter)
  return cut === -1 ? name.trim() : `${path.slice(0, cut + delimiter.length)}${name.trim()}`
}

/** The names of the folders that sit directly in a place, which a new name there must not repeat. */
export function namesIn(folders: Folder[], parentPath: string | null): string[] {
  return folders.filter((folder) => folder.parentPath === parentPath).map((folder) => folder.displayName)
}

/**
 * Takes the new name into the folders that are stored: the folder and every folder under it, which the server renames with it. They keep their
 * ids, which is the point: the messages stored for them and the actions in the queue name the id, and a folder that comes back from the
 * server under another path would be another folder, with the messages fetched again and what waited for it dropped.
 */
export async function renameFolderRows(db: SqlDb, accountId: string, path: string, newPath: string, delimiter: string): Promise<void> {
  const rows = await db.all<{ id: string; imap_path: string; parent_path: string | null }>(
    'SELECT id, imap_path, parent_path FROM folders WHERE account_id = ?',
    accountId
  )
  const below = `${path}${delimiter}`
  const moved = (value: string | null): string | null => {
    if (value === null) return null
    if (value === path) return newPath
    return value.startsWith(below) ? `${newPath}${delimiter}${value.slice(below.length)}` : value
  }
  await db.transaction(async (tx) => {
    for (const row of rows) {
      const next = moved(row.imap_path)
      if (next === row.imap_path) continue
      const name = next === null ? row.imap_path : next.slice(next.lastIndexOf(delimiter) + delimiter.length)
      await tx.run('UPDATE folders SET imap_path = ?, display_name = ?, parent_path = ? WHERE id = ?', next, name, moved(row.parent_path), row.id)
    }
  })
}

/** The UIDs of the messages of a folder, all of them or those not read: what "mark all as read" and "empty" act on. Messages put aside are included. */
export async function folderUids(db: SqlDb, folderId: string, options: { unreadOnly?: boolean } = {}): Promise<number[]> {
  const rows = options.unreadOnly
    ? await db.all<{ uid: number }>(
        `SELECT uid FROM messages WHERE folder_id = ?
           AND NOT EXISTS (SELECT 1 FROM json_each(messages.flags) WHERE lower(json_each.value) = lower(?)) ORDER BY uid`,
        folderId,
        SEEN
      )
    : await db.all<{ uid: number }>('SELECT uid FROM messages WHERE folder_id = ? ORDER BY uid', folderId)
  return rows.map((row) => row.uid)
}
