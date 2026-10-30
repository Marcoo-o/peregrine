import type { PendingMovePayload, PendingSaveDraftPayload } from '@peregrine/core/pendingActions'
import type { SqlDb } from '@peregrine/core/sqlDb'
import type { Folder } from './folders'

/**
 * What the server may do to a folder that the phone has not seen: number its messages anew, or take messages out. The phone
 * keeps messages by their UID, which means something only as long as the server says it does, so a sync asks.
 */

/** The UIDVALIDITY the folder had when it was last synced, or null when it never was (or was before this was kept). */
export async function knownUidValidity(db: SqlDb, folderId: string): Promise<string | null> {
  const row = await db.get<{ uid_validity: string | null }>('SELECT uid_validity FROM folders WHERE id = ?', folderId)
  return row?.uid_validity ?? null
}

export async function rememberUidValidity(db: SqlDb, folderId: string, uidValidity: bigint): Promise<void> {
  await db.run('UPDATE folders SET uid_validity = ? WHERE id = ?', uidValidity.toString(), folderId)
}

/** What a folder that was numbered anew cost the phone. */
export interface FolderReset {
  /** The messages that were kept of it, which are gone from here. */
  messages: number
  /** The changes that were waiting to be made to those messages, which are given up: they would have been made to others. */
  actions: number
}

/** What the log says of a reset, for whoever reads it to find out why a change they made is gone. */
export function resetText(folder: Pick<Folder, 'imapPath'>, reset: FolderReset): string {
  return `The server numbered the folder ${folder.imapPath} anew: the phone forgot ${reset.messages} messages of it and gave up ${reset.actions} changes that waited for them`
}

/**
 * Forgets a folder whose messages the server has numbered anew. The messages go, and so do the actions that waited to
 * be made to them, since an action names a message by its UID and would be made to whichever message has that UID now: a
 * star on one, a deletion of another. A draft that waited to replace the revision kept before is kept all the same, as
 * a new draft that replaces nothing: what the user wrote is not lost, and the old revision is left where it is.
 */
export async function resetFolder(db: SqlDb, folder: Pick<Folder, 'id' | 'accountId'>): Promise<FolderReset> {
  return db.transaction(async (tx) => {
    const cached = await tx.get<{ n: number }>('SELECT COUNT(*) AS n FROM messages WHERE folder_id = ?', folder.id)
    await tx.run('DELETE FROM messages WHERE folder_id = ?', folder.id)

    let actions = 0
    const rows = await tx.all<{ id: number; kind: string; payload: string }>(
      'SELECT id, kind, payload FROM pending_actions WHERE account_id = ? ORDER BY id',
      folder.accountId
    )
    for (const row of rows) {
      const payload = JSON.parse(row.payload) as Record<string, unknown>
      if ((row.kind === 'flags' || row.kind === 'delete') && payload.folderId === folder.id) {
        await tx.run('DELETE FROM pending_actions WHERE id = ?', row.id)
        actions += 1
      } else if (row.kind === 'move' && (payload as unknown as PendingMovePayload).sourceFolderId === folder.id) {
        await tx.run('DELETE FROM pending_actions WHERE id = ?', row.id)
        actions += 1
      } else if (row.kind === 'saveDraft') {
        const draft = payload as unknown as PendingSaveDraftPayload
        if (draft.replace?.folderId !== folder.id) continue
        const { replace: _replace, ...rest } = draft
        await tx.run('UPDATE pending_actions SET payload = ? WHERE id = ?', JSON.stringify(rest), row.id)
      }
    }
    return { messages: cached?.n ?? 0, actions }
  })
}

/**
 * Takes out of a folder the messages that the server no longer has: those in the range that was fetched, from `first` on, that
 * were not among what it gave. A message that was deleted on another device or by a rule of the server would otherwise stay in
 * the list for good. What is older than the range is not asked about and stays.
 */
export async function dropGone(db: SqlDb, folderId: string, first: number, seen: number[]): Promise<number> {
  const kept = new Set(seen)
  const rows = await db.all<{ uid: number }>('SELECT uid FROM messages WHERE folder_id = ? AND uid >= ?', folderId, first)
  const gone = rows.map((row) => row.uid).filter((uid) => !kept.has(uid))
  for (let at = 0; at < gone.length; at += 400) {
    const part = gone.slice(at, at + 400)
    await db.run(`DELETE FROM messages WHERE folder_id = ? AND uid IN (${part.map(() => '?').join(',')})`, folderId, ...part)
  }
  return gone.length
}
