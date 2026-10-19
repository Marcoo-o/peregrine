import { appError } from '@peregrine/core/errorText'
import type { SqlDb } from '../db/sqlDb'
import type { IpcMain } from 'electron'
import { simpleParser } from 'mailparser'
import { IpcChannels } from '@shared/ipcContracts'
import type {
  FolderNode,
  MessageActionResult,
  MessageDetail,
  MessageListFilter,
  MessageListPage,
  MessageListTarget,
  MessageRef,
  MessageSort,
  SnoozeMode,
  SpecialUse,
  UndoMoveEntry
} from '@peregrine/core/types'
import { getFolderById, getFolderBySpecialUse } from '../db/repositories/foldersRepo'
import {
  deleteMessages,
  getMessageByUid,
  isMessageFullySynced,
  listMessagesPage,
  pgpSourceMissingHeaders,
  setMessageHeaders,
  setMessagesFlagged,
  setPendingMove,
  setMessagesRead,
  setMessagesSnoozed,
  storePgpSource,
  updateMessageBody
} from '../db/repositories/messagesRepo'
import {
  cancelPendingAction,
  discardFailedActions,
  dropQueuedMoves,
  listScheduled,
  listWaitingActions,
  pendingSummary,
  removePendingAction
} from '../db/repositories/pendingActionsRepo'
import type {
  PendingDeletePayload,
  PendingFlagsPayload,
  PendingMovePayload,
  PendingSendPayload,
  PendingSummary,
  ScheduledSend,
  WaitingAction
} from '@peregrine/core/pendingActions'
import { persistAttachments } from '../attachments/persist'
import { headersJson, headersJsonOf } from '../mail/headers'
import { parsePgpMime } from '../pgp/pgpMimeParser'
import { readPgpMessage } from '../pgp/readPgp'
import type { AccountManager } from '../accounts/AccountManager'
import { asBuffer } from '../util/buffer'
import { withTimeout } from '../util/withTimeout'

const SYNC_TIMEOUT_MS = 20_000
const FETCH_TIMEOUT_MS = 20_000

/** A batch of UIDs that live in the same folder. The granularity IMAP commands work at. */
interface RefGroup {
  accountId: string
  folderId: string
  uids: number[]
}

function groupRefs(refs: MessageRef[]): RefGroup[] {
  const groups = new Map<string, RefGroup>()
  for (const ref of refs) {
    const key = `${ref.accountId}:${ref.folderId}`
    const group = groups.get(key)
    if (group) group.uids.push(ref.uid)
    else groups.set(key, { accountId: ref.accountId, folderId: ref.folderId, uids: [ref.uid] })
  }
  return Array.from(groups.values())
}

/**
 * Runs one IMAP move and records how to reverse it. The undo entry can only be built when the
 * server hands back the new UIDs (UIDPLUS); `null` from any group makes the whole action
 * non-undoable rather than partially reversible.
 */
async function moveGroup(
  db: SqlDb,
  accountManager: AccountManager,
  group: RefGroup,
  target: FolderNode
): Promise<UndoMoveEntry | null> {
  const source = await getFolderById(db, group.folderId)
  if (!source || source.id === target.id) return null

  const imap = accountManager.getImapConnection(group.accountId)
  if (!imap) {
    // A move already waiting for these same messages is replaced, not queued behind: the
    // older one would run first and carry them somewhere the user has since changed their
    // mind about.
    await dropQueuedMoves(db, group.accountId, group.folderId, group.uids)
    await accountManager.enqueueOffline(group.accountId, 'move', {
      sourceFolderId: group.folderId,
      targetFolderId: target.id,
      uids: group.uids
    })
    // The row stays where it is. Carrying it into the target would give it a UID the server
    // has not assigned, and the next sync of that folder would fetch the same message again
    // under its real number. One message, twice in the list. Deleting it instead, as this
    // did before, left the message in no folder at all until the target synced: not in the
    // list, not findable, not correctable. Where it is now is still true, so it is listed
    // there, marked with where it is headed.
    await setPendingMove(db, group.folderId, group.uids, target.id)
    // No undo entry: the reverse would be a move from this folder into itself, which is
    // filtered out above. Cancelling means moving it somewhere else, which replaces the
    // queued move as of a few lines ago.
    return null
  }

  // The connection came back before the queue ran: this move happens now, so the waiting one
  // has nothing left to do. Left in place it would keep counting towards "actions waiting".
  await dropQueuedMoves(db, group.accountId, group.folderId, group.uids)
  const uidMap = await imap.moveMessages(source.imapPath, target.imapPath, group.uids)
  await deleteMessages(db, group.folderId, group.uids)

  if (!uidMap) return null
  return {
    accountId: group.accountId,
    folderId: target.id,
    uids: group.uids.map((uid) => uidMap.get(uid)).filter((uid): uid is number => uid != null),
    targetFolderId: source.id
  }
}

function collectUndo(entries: (UndoMoveEntry | null)[]): UndoMoveEntry[] | null {
  const usable = entries.filter((entry): entry is UndoMoveEntry => entry != null && entry.uids.length > 0)
  return usable.length === entries.length && usable.length > 0 ? usable : null
}

/**
 * Moves each group into the special-use folder of its own account. Unified views mix messages
 * from several accounts in one selection, and "archive" has to mean each account's own archive
 * folder. A cross-account IMAP move is impossible anyway.
 */
async function moveGroupsToSpecialUse(
  db: SqlDb,
  accountManager: AccountManager,
  refs: MessageRef[],
  specialUse: SpecialUse
): Promise<MessageActionResult> {
  let movedCount = 0
  const undoEntries: (UndoMoveEntry | null)[] = []
  for (const group of groupRefs(refs)) {
    const target = await getFolderBySpecialUse(db, group.accountId, specialUse)
    if (!target) continue
    undoEntries.push(await moveGroup(db, accountManager, group, target))
    movedCount += group.uids.length
  }
  return { movedCount, undo: collectUndo(undoEntries) }
}

export function registerMessagesIpc(ipcMain: IpcMain, db: SqlDb, accountManager: AccountManager): void {
  ipcMain.handle(
    IpcChannels.messagesList,
    async (
      _event,
      args: {
        targets: MessageListTarget[]
        cursor?: string
        pageSize: number
        filter?: MessageListFilter
        sort?: MessageSort
        sync?: boolean
        query?: string
        snooze?: SnoozeMode
      }
    ): Promise<MessageListPage> => {
      // Only sync on the first page of a folder view, not on "load more" pagination,
      // otherwise a mid-scroll sync could shift the ordered result set underneath us.
      // Re-sorting or filtering passes sync: false, since the cache already holds the rows.
      if (!args.cursor && args.sync !== false) {
        // Unified views span several folders; sync them concurrently so opening the unified
        // inbox costs one round trip rather than one per account.
        await Promise.all(
          args.targets.map(async (target) => {
            const folder = await getFolderById(db, target.folderId)
            if (!folder) return
            try {
              await withTimeout(
                accountManager.syncFolderNow(target.accountId, folder.imapPath),
                SYNC_TIMEOUT_MS,
                `Sync of folder ${folder.imapPath}`
              )
            } catch (err) {
              // Fall back to whatever is already cached locally rather than blocking the UI
              // indefinitely on a slow/unresponsive server.
              console.error('folder sync failed:', err instanceof Error ? err.message : err)
            }
          })
        )
      }
      return listMessagesPage(
        db,
        args.targets.map((target) => target.folderId),
        args.cursor,
        args.pageSize,
        args.filter,
        args.sort,
        args.query,
        args.snooze
      )
    }
  )

  ipcMain.handle(IpcChannels.pendingGet, (): Promise<PendingSummary> => pendingSummary(db))

  ipcMain.handle(IpcChannels.pendingDiscardFailed, async (): Promise<PendingSummary> => {
    await discardFailedActions(db)
    return pendingSummary(db)
  })

  ipcMain.handle(IpcChannels.pendingScheduled, async (): Promise<ScheduledSend[]> =>
    (await listScheduled(db))
      .filter((action) => action.kind === 'send' && action.dueAt !== null)
      .map((action) => {
        const { input } = action.payload as PendingSendPayload
        return {
          id: action.id,
          accountId: action.accountId,
          subject: input.subject,
          recipients: [...input.to, ...input.cc]
            .map((address) => address.name || address.address)
            .join(', '),
          dueAt: action.dueAt as number
        }
      })
  )

  ipcMain.handle(
    IpcChannels.pendingCancel,
    async (_event, args: { id: number }): Promise<PendingSummary> => {
      // Nothing to recall from a server: a queued action is by definition one that never got
      // there. What it did change here, a move's mark on its messages, goes with it.
      await cancelPendingAction(db, args.id)
      await accountManager.armDueTimer()
      return pendingSummary(db)
    }
  )

  ipcMain.handle(IpcChannels.pendingWaiting, async (): Promise<WaitingAction[]> =>
    Promise.all((await listWaitingActions(db)).map(async (action): Promise<WaitingAction> => {
      const folderName = async (folderId: string | undefined): Promise<string> =>
        folderId ? ((await getFolderById(db, folderId))?.displayName ?? '') : ''

      if (action.kind === 'send') {
        const { input } = action.payload as PendingSendPayload
        return {
          id: action.id,
          accountId: action.accountId,
          kind: action.kind,
          messageCount: 1,
          sourceFolder: '',
          targetFolder: '',
          subject: input.subject,
          createdAt: action.createdAt
        }
      }

      const payload = action.payload as
        | PendingMovePayload
        | PendingDeletePayload
        | PendingFlagsPayload
      const source = 'sourceFolderId' in payload ? payload.sourceFolderId : payload.folderId
      return {
        id: action.id,
        accountId: action.accountId,
        kind: action.kind,
        messageCount: payload.uids.length,
        sourceFolder: await folderName(source),
        targetFolder: 'targetFolderId' in payload ? await folderName(payload.targetFolderId) : '',
        subject: '',
        createdAt: action.createdAt
      }
    }))
  )

  ipcMain.handle(
    IpcChannels.messagesSnooze,
    async (_event, args: { refs: MessageRef[]; until: number | null }): Promise<void> => {
      // Local only, deliberately: putting a message aside on the server would mean moving it
      // to a folder of our own making, which every other client would then show as a stray
      // folder full of mail that looks misfiled. The cost is that the message stays in the
      // inbox on the phone. Said plainly in the interface rather than worked around here.
      await setMessagesSnoozed(
        db,
        args.refs.map((ref) => ({ folderId: ref.folderId, uid: ref.uid })),
        args.until
      )
      await accountManager.rescheduleSnooze()
    }
  )

  ipcMain.handle(
    IpcChannels.messagesGet,
    async (
      _event,
      args: { accountId: string; folderId: string; uid: number }
    ): Promise<MessageDetail> => {
      const existing = await getMessageByUid(db, args.folderId, args.uid)
      // Not "has a body": the background indexer fills in body_text without the attachments,
      // so only a completed full fetch may short-circuit here.
      if (existing && (await isMessageFullySynced(db, existing.id))) {
        const withoutHeaders = await pgpSourceMissingHeaders(db, existing.id)
        if (withoutHeaders === null) return readPgpMessage(db, args.accountId, existing)

        // Stored before the envelope headers were kept. Read once, then never again.
        await setMessageHeaders(
          db,
          existing.id,
          await headersJsonOf(Buffer.from(withoutHeaders, 'utf8'))
        )
        const filled = (await getMessageByUid(db, args.folderId, args.uid)) as MessageDetail
        return readPgpMessage(db, args.accountId, filled)
      }

      const folder = await getFolderById(db, args.folderId)
      const imap = accountManager.getImapConnection(args.accountId)
      if (!folder || !imap || !existing) {
        throw appError('messageUnavailable')
      }

      const raw = await withTimeout(
        imap.fetchFullMessage(folder.imapPath, args.uid),
        FETCH_TIMEOUT_MS,
        'Fetching message body'
      )
      if (!raw?.source) {
        throw appError('bodyFetchFailed')
      }

      const bytes = asBuffer(raw.source)
      const source = bytes.toString('utf8')

      // A PGP/MIME message is kept as it arrived instead of being parsed into text and HTML:
      // the ciphertext must not be unwrapped onto disk, and a detached signature can only be
      // checked against the exact bytes it covers. Both are worked out on every read.
      if (parsePgpMime(source).kind !== 'none') {
        // The envelope is parsed all the same. Only for its headers, never for its body.
        // Reply-To and Authentication-Results are read from there, and leaving them out
        // switched both checks off on the messages that look most trustworthy.
        await storePgpSource(db, existing.id, source, await headersJsonOf(bytes))
        const stored = (await getMessageByUid(db, args.folderId, args.uid)) as MessageDetail
        return readPgpMessage(db, args.accountId, stored)
      }

      const parsed = await simpleParser(bytes)
      await updateMessageBody(
        db,
        existing.id,
        parsed.text ?? null,
        parsed.html || null,
        headersJson(parsed.headers)
      )
      await persistAttachments(db, args.accountId, existing.id, parsed.attachments)

      const detail = (await getMessageByUid(db, args.folderId, args.uid)) as MessageDetail
      return readPgpMessage(db, args.accountId, detail)
    }
  )

  ipcMain.handle(
    IpcChannels.messagesMarkRead,
    async (_event, args: { refs: MessageRef[]; read: boolean }): Promise<void> => {
      for (const group of groupRefs(args.refs)) {
        const folder = await getFolderById(db, group.folderId)
        const imap = accountManager.getImapConnection(group.accountId)
        if (folder && imap) {
          for (const uid of group.uids) {
            await imap.setFlags(folder.imapPath, uid, args.read ? ['\\Seen'] : [])
          }
        } else if (folder) {
          // Without a connection the change used to be applied here and nowhere else. The
          // two sides drifted apart and nothing said so. Now it waits for the next one.
          await accountManager.enqueueOffline(group.accountId, 'flags', {
            folderId: group.folderId,
            uids: group.uids,
            add: args.read ? ['\\Seen'] : [],
            remove: args.read ? [] : ['\\Seen']
          })
        }
        await setMessagesRead(db, group.folderId, group.uids, args.read)
      }
    }
  )

  ipcMain.handle(
    IpcChannels.messagesSetFlagged,
    async (_event, args: { refs: MessageRef[]; flagged: boolean }): Promise<void> => {
      for (const group of groupRefs(args.refs)) {
        const folder = await getFolderById(db, group.folderId)
        const imap = accountManager.getImapConnection(group.accountId)
        if (folder && imap) {
          for (const uid of group.uids) {
            if (args.flagged) await imap.addFlags(folder.imapPath, uid, ['\\Flagged'])
            else await imap.removeFlags(folder.imapPath, uid, ['\\Flagged'])
          }
        } else if (folder) {
          await accountManager.enqueueOffline(group.accountId, 'flags', {
            folderId: group.folderId,
            uids: group.uids,
            add: args.flagged ? ['\\Flagged'] : [],
            remove: args.flagged ? [] : ['\\Flagged']
          })
        }
        await setMessagesFlagged(db, group.folderId, group.uids, args.flagged)
      }
    }
  )

  ipcMain.handle(
    IpcChannels.messagesMove,
    async (
      _event,
      args: { refs: MessageRef[]; targetFolderId: string }
    ): Promise<MessageActionResult> => {
      const targetFolder = await getFolderById(db, args.targetFolderId)
      if (!targetFolder) throw appError('targetFolderUnavailable')

      let movedCount = 0
      const undoEntries: (UndoMoveEntry | null)[] = []
      for (const group of groupRefs(args.refs)) {
        // IMAP has no cross-server move, so a unified selection can only move the messages
        // belonging to the target folder's own account.
        if (group.accountId !== targetFolder.accountId) continue
        undoEntries.push(await moveGroup(db, accountManager, group, targetFolder))
        movedCount += group.uids.length
      }
      return { movedCount, undo: collectUndo(undoEntries) }
    }
  )

  ipcMain.handle(
    IpcChannels.messagesArchive,
    (_event, args: { refs: MessageRef[] }): Promise<MessageActionResult> =>
      moveGroupsToSpecialUse(db, accountManager, args.refs, 'archive')
  )

  ipcMain.handle(
    IpcChannels.messagesJunk,
    (_event, args: { refs: MessageRef[] }): Promise<MessageActionResult> =>
      moveGroupsToSpecialUse(db, accountManager, args.refs, 'junk')
  )

  ipcMain.handle(
    IpcChannels.messagesDelete,
    async (
      _event,
      args: { refs: MessageRef[]; permanent?: boolean }
    ): Promise<MessageActionResult> => {
      let movedCount = 0
      const undoEntries: (UndoMoveEntry | null)[] = []

      for (const group of groupRefs(args.refs)) {
        const folder = await getFolderById(db, group.folderId)
        if (!folder) throw appError('folderUnavailable')
        const imap = accountManager.getImapConnection(group.accountId)

        // Deleting from the trash itself (or with `permanent`) expunges; everything else lands
        // in the account's trash folder first, matching what every other mail client does.
        const trash: FolderNode | undefined = args.permanent
          ? undefined
          : await getFolderBySpecialUse(db, group.accountId, 'trash')

        if (trash && trash.id !== folder.id) {
          undoEntries.push(await moveGroup(db, accountManager, group, trash))
          movedCount += group.uids.length
        } else if (imap) {
          // Destroying a message settles where it was going to go. Both delete paths drop the
          // queued move first, so nothing is left announcing a journey for a message that no
          // longer exists.
          await dropQueuedMoves(db, group.accountId, group.folderId, group.uids)
          // An expunge cannot be taken back, so this path never reports an undo entry.
          await imap.deleteMessages(folder.imapPath, group.uids)
          await deleteMessages(db, group.folderId, group.uids)
          undoEntries.push(null)
        } else {
          await dropQueuedMoves(db, group.accountId, group.folderId, group.uids)
          await accountManager.enqueueOffline(group.accountId, 'delete', {
            folderId: group.folderId,
            uids: group.uids
          })
          await deleteMessages(db, group.folderId, group.uids)
          undoEntries.push(null)
        }
      }
      return { movedCount, undo: collectUndo(undoEntries) }
    }
  )
}
