import { listAllActions } from '@peregrine/core/pendingActionsStore'
import type { PendingSendPayload } from '@peregrine/core/pendingActions'
import type { SqlDb } from '@peregrine/core/sqlDb'
import type { Files } from './files'

/**
 * The copies of attached files that a message in the queue still needs, those of messages given up on
 * included: they are kept until somebody discards the message, and then they are not needed.
 */
export async function referencedCopies(db: SqlDb): Promise<string[]> {
  const actions = await listAllActions(db)
  return actions
    .filter((action) => action.kind === 'send')
    .flatMap((action) => (action.payload as PendingSendPayload).input.attachments.map((attached) => attached.path))
}

/**
 * Removes every copy of an attached file that no message in the queue refers to.
 *
 * A copy is made when a file is picked and removed when its message has gone out or is given up before it
 * was written. Three things leave one behind: a message that is discarded after it failed too often, an
 * account that is removed with a message waiting in its queue, and an application that is stopped
 * between picking and sending. Nothing refers to the copy then and nothing would ever remove it. One
 * sweep that keeps what is referred to covers all three.
 *
 * Not to be run while a message is being written: its copies are not in the queue yet.
 */
export async function sweepCopies(db: SqlDb, files: Pick<Files, 'keepOnly'>): Promise<void> {
  await files.keepOnly(await referencedCopies(db))
}
