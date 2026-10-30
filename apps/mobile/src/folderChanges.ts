import type { PendingMovePayload, PendingSaveDraftPayload } from '@peregrine/core/pendingActions'
import { listPendingActions } from '@peregrine/core/pendingActionsStore'
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

/** The oldest and the newest UID of the messages the phone has of a folder, and how many it has; null when it has none. */
export async function cachedBounds(db: SqlDb, folderId: string): Promise<{ min: number; max: number; count: number } | null> {
  const row = await db.get<{ min: number | null; max: number | null; count: number }>(
    'SELECT MIN(uid) AS min, MAX(uid) AS max, COUNT(*) AS count FROM messages WHERE folder_id = ?',
    folderId
  )
  return row && row.min !== null && row.max !== null ? { min: row.min, max: row.max, count: row.count } : null
}

/** Forgets every message of a folder here, and nothing else: what waits in the queue names UIDs the server still has. */
export async function clearMessages(db: SqlDb, folderId: string): Promise<void> {
  await db.run('DELETE FROM messages WHERE folder_id = ?', folderId)
}

/** What a sync made of what it already had: how many messages were taken out, and how many had their flags changed. */
export interface Reconciled {
  gone: number
  changed: number
}

const sameFlags = (a: string[], b: string[]): boolean => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n')

/**
 * Brings what the phone has of a folder in line with what the server says it has, from the list of every message of the folder with its
 * flags that a sync gets: the messages it no longer has are taken out of the list, whatever their age (one that was deleted on another
 * device would stay for good), what was read or starred elsewhere shows so, and the number of messages that the server has is kept, which
 * is how the list knows whether there is older mail to load.
 *
 * What the user has decided and the queue has not yet told the server is not undone by it: a message with a change waiting for it keeps
 * the flags it has here.
 */
export async function reconcile(db: SqlDb, folder: Pick<Folder, 'id' | 'accountId'>, onServer: { uid: number; flags: string[] }[]): Promise<Reconciled> {
  const waiting = new Set<number>()
  for (const action of await listPendingActions(db, folder.accountId)) {
    const payload = action.payload as { folderId?: string; sourceFolderId?: string; uids?: number[] }
    const named = action.kind === 'flags' || action.kind === 'delete' ? payload.folderId : action.kind === 'move' ? payload.sourceFolderId : undefined
    if (named === folder.id) for (const uid of payload.uids ?? []) waiting.add(uid)
  }
  const there = new Map(onServer.map((message) => [message.uid, message.flags]))
  return db.transaction(async (tx) => {
    const cached = await tx.all<{ uid: number; flags: string }>('SELECT uid, flags FROM messages WHERE folder_id = ?', folder.id)
    const gone: number[] = []
    let changed = 0
    for (const row of cached) {
      const flags = there.get(row.uid)
      if (flags === undefined) {
        gone.push(row.uid)
      } else if (!waiting.has(row.uid) && !sameFlags(JSON.parse(row.flags) as string[], flags)) {
        await tx.run('UPDATE messages SET flags = ? WHERE folder_id = ? AND uid = ?', JSON.stringify(flags), folder.id, row.uid)
        changed += 1
      }
    }
    for (let at = 0; at < gone.length; at += 400) {
      const part = gone.slice(at, at + 400)
      await tx.run(`DELETE FROM messages WHERE folder_id = ? AND uid IN (${part.map(() => '?').join(',')})`, folder.id, ...part)
    }
    await tx.run('UPDATE folders SET server_messages = ? WHERE id = ?', onServer.length, folder.id)
    return { gone: gone.length, changed }
  })
}

/** Whether the server has messages in a folder that the phone has not loaded: older ones, since the newer ones come with every sync. */
export async function hasOlder(db: SqlDb, folderId: string): Promise<boolean> {
  const row = await db.get<{ server_messages: number | null }>('SELECT server_messages FROM folders WHERE id = ?', folderId)
  if (row?.server_messages === null || row?.server_messages === undefined) return false
  const bounds = await cachedBounds(db, folderId)
  return (bounds?.count ?? 0) < row.server_messages
}
