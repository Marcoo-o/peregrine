import type { SqlDb } from '../sqlDb'
import { cancelPendingAction as cancel, discardFailedActions as discard } from '@peregrine/core/pendingActionsStore'
import { setPendingMove } from './messagesRepo'

/**
 * The queue's storage is in `@peregrine/core`, written once for the desktop and the phone. What is
 * here is the one thing it cannot know: that the mark of a queued move is a column of the desktop's
 * messages. The names are the ones the rest of the main process has always imported.
 */
export {
  dropQueuedMoves,
  enqueueAction,
  listPendingActions,
  listScheduled,
  listWaitingActions,
  nextDueAt,
  pendingSummary,
  recordPendingFailure,
  removePendingAction
} from '@peregrine/core/pendingActionsStore'

function clearMoveMark(db: SqlDb, sourceFolderId: string, uids: number[]): Promise<void> {
  return setPendingMove(db, sourceFolderId, uids, null)
}

export function cancelPendingAction(db: SqlDb, id: number): Promise<void> {
  return cancel(db, id, clearMoveMark)
}

export function discardFailedActions(db: SqlDb, accountId?: string): Promise<void> {
  return discard(db, clearMoveMark, accountId)
}
