import type { ComposeInput } from './types'

/**
 * What an action waiting for a connection looks like.
 *
 * The shapes live in shared because both sides need them: the main process replays them, and
 * the renderer shows what is waiting. "3 Aktionen warten" is not enough when one of them is
 * a deletion.
 */

export interface PendingFlagsPayload {
  folderId: string
  uids: number[]
  /** Flags to add and to remove; a tag is a keyword like any other flag. */
  add: string[]
  remove: string[]
}

export interface PendingMovePayload {
  sourceFolderId: string
  targetFolderId: string
  uids: number[]
}

export interface PendingDeletePayload {
  folderId: string
  uids: number[]
}

/**
 * A message that could not go out yet.
 *
 * The whole compose input is kept, attachments included. It is the only way to send exactly
 * what the user wrote once a connection is back. Everything else in this table refers to mail
 * that already exists on a server; this one *is* the mail.
 */
export interface PendingSendPayload {
  input: ComposeInput
}

/**
 * A message that is not finished, to be kept in the drafts folder when there is a connection.
 *
 * `draftKey` says which writing of a message it belongs to: a newer revision of the same writing replaces one that is still
 * waiting, so that a message written without a connection is kept once, as it is when the connection comes, and not
 * as many times as it was changed. `replace` is the revision that was kept before, which goes once the new one is kept.
 */
export interface PendingSaveDraftPayload {
  draftKey: string
  input: ComposeInput
  replace?: { folderId: string; uid: number }
}

export type PendingActionKind = 'flags' | 'move' | 'delete' | 'send' | 'saveDraft'

export type PendingPayload =
  | PendingFlagsPayload
  | PendingMovePayload
  | PendingDeletePayload
  | PendingSendPayload
  | PendingSaveDraftPayload

export interface PendingAction {
  id: number
  accountId: string
  kind: PendingActionKind
  payload: PendingPayload
  createdAt: number
  attempts: number
  lastError: string | null
  /** Epoch ms before which it must not run; null means as soon as possible. */
  dueAt: number | null
}

/** What the renderer shows: one line per account, plus what the actions actually are. */
export interface PendingSummary {
  total: number
  byKind: Record<PendingActionKind, number>
  /** Actions that were given up on, so they can be reported rather than vanish. */
  failed: number
  /**
   * Waiting for a chosen moment rather than for a connection.
   *
   * Counted apart because the two mean different things to the user: "waiting for a
   * connection" is a problem, "goes out on Monday at eight" is a plan. One number for both
   * would blur exactly that.
   */
  scheduled: number
}

/** A scheduled message as the interface shows it. Enough to recognise and to call back. */
export interface ScheduledSend {
  id: number
  accountId: string
  subject: string
  recipients: string
  dueAt: number
}

/**
 * An action waiting for a connection, as the interface shows it.
 *
 * Enough to recognise which one it is and to decide against it. The folder names are resolved
 * here rather than left as ids: "moved to Archiv" is a sentence somebody can act on, and a
 * pair of UUIDs is not.
 */
export interface WaitingAction {
  id: number
  accountId: string
  kind: PendingActionKind
  /** How many messages this one action covers. */
  messageCount: number
  sourceFolder: string
  targetFolder: string
  /** Filled for a queued message; empty for everything that acts on existing mail. */
  subject: string
  createdAt: number
}

/**
 * After this many failed connections an action is given up on.
 *
 * Not zero and not endless. An action that fails five times in a row on five separate
 * connections is not failing because of the network, and retrying it forever would hold up
 * everything queued behind it. The order is the whole point of the queue.
 */
export const MAX_ATTEMPTS = 5

/**
 * A queued move with some of its messages taken out. `null` when none are left.
 *
 * Needed because a second decision about the same message must replace the first, not queue
 * behind it. Two moves of one UID would run in order: the first carries it off, and the second
 * addresses a UID that is no longer in the source folder. IMAP does not treat that as an
 * error, because a UID command simply skips what it cannot find, so the message would end up
 * wherever the *first* move sent it, which is the one the user changed their mind about.
 */
export function movePayloadWithout(
  payload: PendingMovePayload,
  uids: number[]
): PendingMovePayload | null {
  const remaining = payload.uids.filter((uid) => !uids.includes(uid))
  if (remaining.length === 0) return null
  return { ...payload, uids: remaining }
}

export function emptySummary(): PendingSummary {
  return { total: 0, byKind: { flags: 0, move: 0, delete: 0, send: 0, saveDraft: 0 }, failed: 0, scheduled: 0 }
}
