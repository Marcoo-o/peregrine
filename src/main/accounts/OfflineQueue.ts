import type { WebContents } from 'electron'
import { IpcChannels } from '@shared/ipcContracts'
import type { ImapSession } from '@peregrine/core/imapSession'
import { QueueRunner, type QueueLocalMail, type QueueStore } from '@peregrine/core/offlineQueue'
import type { ComposeInput } from '@peregrine/core/types'
import type { SqlDb } from '../db/sqlDb'
import { getFolderById } from '../db/repositories/foldersRepo'
import { deleteMessages, setPendingMove } from '../db/repositories/messagesRepo'
import {
  listPendingActions,
  nextDueAt,
  pendingSummary,
  recordPendingFailure,
  removePendingAction
} from '../db/repositories/pendingActionsRepo'

/**
 * Replays what was done while there was no connection: the desktop's side of it.
 *
 * The rules are in `QueueRunner` in `@peregrine/core`, which the phone's application runs as
 * well. What is here is what only the desktop knows: that the actions are rows of its database,
 * that a folder id is a row of its folders, that the window is told over IPC, and that the
 * timers are Node's. The methods are the ones the rest of the main process has always called.
 */
export class OfflineQueue {
  private readonly runner: QueueRunner

  constructor(
    private readonly db: SqlDb,
    private readonly getWebContents: () => WebContents | undefined
  ) {
    const store: QueueStore = {
      list: (accountId) => listPendingActions(db, accountId),
      remove: (id) => removePendingAction(db, id),
      recordFailure: (id, message) => recordPendingFailure(db, id, message),
      nextDueAt: () => nextDueAt(db)
    }
    const local: QueueLocalMail = {
      folderPath: async (folderId) => (await getFolderById(db, folderId))?.imapPath ?? null,
      forgetMoved: (sourceFolderId, uids) => deleteMessages(db, sourceFolderId, uids),
      clearMoveMark: (sourceFolderId, uids) => setPendingMove(db, sourceFolderId, uids, null)
    }
    this.runner = new QueueRunner(store, local, {
      changed: () => this.notify(),
      log: {
        warn: (message) => console.warn(message),
        error: (message) => console.error(message)
      }
    })
  }

  /** Sending lives in the compose module, which is registered after this one exists. */
  setSendHandler(send: (input: ComposeInput) => Promise<unknown>): void {
    this.runner.setSendHandler(send)
  }

  /** Wakes the queue when the next scheduled message is due. */
  rescheduleDue(runFlush: () => void): Promise<void> {
    return this.runner.rescheduleDue(runFlush)
  }

  stop(): void {
    this.runner.stop()
  }

  /** Sends the current state to the renderer; called after anything changed. */
  async notify(): Promise<void> {
    this.getWebContents()?.send(IpcChannels.pendingActions, await pendingSummary(this.db))
  }

  flush(accountId: string, imap: ImapSession): Promise<void> {
    return this.runner.flush(accountId, imap)
  }
}
