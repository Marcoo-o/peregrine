import type { SqlDb } from '../sqlDb'
import { randomUUID } from 'node:crypto'
import type { FolderNode, SpecialUse } from '@peregrine/core/types'

interface FolderRow {
  id: string
  account_id: string
  imap_path: string
  display_name: string
  special_use: SpecialUse
  parent_id: string | null
  unread_count?: number
  total_count?: number
}

function toNode(row: FolderRow): FolderNode {
  return {
    id: row.id,
    accountId: row.account_id,
    imapPath: row.imap_path,
    displayName: row.display_name,
    specialUse: row.special_use,
    parentId: row.parent_id,
    unreadCount: row.unread_count ?? 0,
    totalCount: row.total_count ?? 0
  }
}

const FOLDER_COUNT_COLUMNS = `(
    SELECT COUNT(*) FROM messages m WHERE m.folder_id = f.id AND m.is_read = 0
  ) AS unread_count, (
    SELECT COUNT(*) FROM messages m WHERE m.folder_id = f.id
  ) AS total_count`

export async function listFolders(db: SqlDb, accountId: string): Promise<FolderNode[]> {
  const rows = await db.all<FolderRow>(
    `SELECT f.*, ${FOLDER_COUNT_COLUMNS}
     FROM folders f WHERE f.account_id = ? ORDER BY f.imap_path ASC`,
    accountId
  )
  return rows.map(toNode)
}

/** Every account's folders in one call. The sidebar renders all mailboxes at once. */
export async function listAllFolders(db: SqlDb): Promise<FolderNode[]> {
  const rows = await db.all<FolderRow>(
    `SELECT f.*, ${FOLDER_COUNT_COLUMNS}
     FROM folders f ORDER BY f.account_id ASC, f.imap_path ASC`
  )
  return rows.map(toNode)
}

export async function getFolderById(db: SqlDb, folderId: string): Promise<FolderNode | undefined> {
  const row = await db.get<FolderRow>('SELECT * FROM folders WHERE id = ?', folderId)
  return row ? toNode(row) : undefined
}

export async function getFolderBySpecialUse(
  db: SqlDb,
  accountId: string,
  specialUse: SpecialUse
): Promise<FolderNode | undefined> {
  const row = await db.get<FolderRow>(
    'SELECT * FROM folders WHERE account_id = ? AND special_use = ?',
    accountId,
    specialUse
  )
  return row ? toNode(row) : undefined
}

export async function getFolderByPath(
  db: SqlDb,
  accountId: string,
  imapPath: string
): Promise<FolderNode | undefined> {
  const row = await db.get<FolderRow>(
    'SELECT * FROM folders WHERE account_id = ? AND imap_path = ?',
    accountId,
    imapPath
  )
  return row ? toNode(row) : undefined
}

export interface UpsertFolderInput {
  accountId: string
  imapPath: string
  displayName: string
  specialUse: SpecialUse
  parentId: string | null
  uidValidity?: number
  uidNext?: number
}

export async function upsertFolder(db: SqlDb, input: UpsertFolderInput): Promise<string> {
  // Look, then update or insert. Folder syncs for one account can overlap, and two that both
  // found no row would both insert.
  return db.transaction(async (tx) => {
    const existing = await getFolderByPath(tx, input.accountId, input.imapPath)
    if (existing) {
      await tx.run(
        `UPDATE folders SET display_name = @displayName, special_use = @specialUse, parent_id = @parentId,
         uid_validity = COALESCE(@uidValidity, uid_validity), uid_next = COALESCE(@uidNext, uid_next)
         WHERE id = @id`,
        {
          id: existing.id,
          displayName: input.displayName,
          specialUse: input.specialUse,
          parentId: input.parentId,
          uidValidity: input.uidValidity ?? null,
          uidNext: input.uidNext ?? null
        }
      )
      return existing.id
    }

    const id = randomUUID()
    await tx.run(
      `INSERT INTO folders (id, account_id, imap_path, display_name, special_use, parent_id, uid_validity, uid_next)
       VALUES (@id, @accountId, @imapPath, @displayName, @specialUse, @parentId, @uidValidity, @uidNext)`,
      {
        id,
        accountId: input.accountId,
        imapPath: input.imapPath,
        displayName: input.displayName,
        specialUse: input.specialUse,
        parentId: input.parentId,
        uidValidity: input.uidValidity ?? null,
        uidNext: input.uidNext ?? null
      }
    )
    return id
  })
}

export async function renameFolder(
  db: SqlDb,
  folderId: string,
  displayName: string,
  imapPath: string
): Promise<void> {
  await db.run(
    'UPDATE folders SET display_name = ?, imap_path = ? WHERE id = ?',
    displayName,
    imapPath,
    folderId
  )
}

/** Child folders and cached messages go with it (both cascade on delete). */
export async function deleteFolder(db: SqlDb, folderId: string): Promise<void> {
  await db.run('DELETE FROM folders WHERE id = ?', folderId)
}

export async function setFolderParent(
  db: SqlDb,
  folderId: string,
  parentId: string | null
): Promise<void> {
  await db.run('UPDATE folders SET parent_id = ? WHERE id = ?', parentId, folderId)
}

/** What the last sync of a folder recorded about the server's numbering. */
export async function getFolderSyncState(
  db: SqlDb,
  folderId: string
): Promise<{ validity: number | null; next: number | null } | undefined> {
  return db.get<{ validity: number | null; next: number | null }>(
    'SELECT uid_validity as validity, uid_next as next FROM folders WHERE id = ?',
    folderId
  )
}

export async function countFolderMessages(db: SqlDb, folderId: string): Promise<number> {
  const row = await db.get<{ c: number }>(
    'SELECT COUNT(*) as c FROM messages WHERE folder_id = ?',
    folderId
  )
  return row!.c
}

export async function invalidateFolderCache(db: SqlDb, folderId: string): Promise<void> {
  await db.run('DELETE FROM messages WHERE folder_id = ?', folderId)
}
