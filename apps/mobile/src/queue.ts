import type { QueueEnvironment, QueueLocalMail, QueueStore } from '@peregrine/core/offlineQueue'
import { QueueRunner } from '@peregrine/core/offlineQueue'
import {
  listPendingActions,
  nextDueAt,
  recordPendingFailure,
  removePendingAction
} from '@peregrine/core/pendingActionsStore'
import type { SqlDb } from '@peregrine/core/sqlDb'
import { getFolder } from './folders'
import { deleteMessages, setPendingMove } from './messages'

/**
 * The offline queue as the phone has it: the replay of `@peregrine/core`, over this database.
 *
 * It is the engine the desktop runs, and the storage functions the desktop calls, so the order of
 * replay, the limit of attempts and the rules for a folder that is gone are the same on both. What
 * is here is what only the phone knows: that a folder id is a row of `folders`, and what to do to
 * `messages` when the server has moved some.
 */
export function createQueue(db: SqlDb, environment: QueueEnvironment): QueueRunner {
  const store: QueueStore = {
    list: (accountId) => listPendingActions(db, accountId),
    remove: (id) => removePendingAction(db, id),
    recordFailure: (id, message) => recordPendingFailure(db, id, message),
    nextDueAt: () => nextDueAt(db)
  }
  const local: QueueLocalMail = {
    folderPath: async (folderId) => (await getFolder(db, folderId))?.imapPath ?? null,
    forgetMoved: (sourceFolderId, uids) => deleteMessages(db, sourceFolderId, uids),
    clearMoveMark: (sourceFolderId, uids) => setPendingMove(db, sourceFolderId, uids, null)
  }
  return new QueueRunner(store, local, environment)
}
