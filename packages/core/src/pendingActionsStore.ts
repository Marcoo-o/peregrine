import type { SqlDb } from './sqlDb'
import {
  emptySummary,
  MAX_ATTEMPTS,
  movePayloadWithout,
  type PendingAction,
  type PendingActionKind,
  type PendingMovePayload,
  type PendingPayload,
  type PendingSummary
} from './pendingActions'

/**
 * Clears the mark that said a queued move was coming, for these messages. It is told the handle it
 * is to use, because it is called inside a transaction, and what it changes belongs to the mail of
 * the device, which this module does not know the shape of.
 */
export type ClearMoveMark = (db: SqlDb, sourceFolderId: string, uids: number[]) => Promise<void>

interface PendingRow {
  id: number
  account_id: string
  kind: string
  payload: string
  created_at: number
  attempts: number
  last_error: string | null
  due_at: number | null
}

function toAction(row: PendingRow): PendingAction {
  return {
    id: row.id,
    accountId: row.account_id,
    kind: row.kind as PendingActionKind,
    payload: JSON.parse(row.payload) as PendingPayload,
    createdAt: row.created_at,
    attempts: row.attempts,
    lastError: row.last_error,
    dueAt: row.due_at ?? null
  }
}

export async function enqueueAction(
  db: SqlDb,
  accountId: string,
  kind: PendingActionKind,
  payload: PendingPayload,
  /** Epoch ms before which this must not run; null means as soon as possible. */
  dueAt: number | null = null
): Promise<number> {
  const result = await db.run(
    'INSERT INTO pending_actions (account_id, kind, payload, created_at, due_at) VALUES (?, ?, ?, ?, ?)',
    accountId,
    kind,
    JSON.stringify(payload),
    Date.now(),
    dueAt
  )
  return Number(result.lastInsertRowid)
}

/**
 * The next moment *still ahead* at which something scheduled becomes due.
 *
 * Deliberately future-only. A row whose moment has already passed needs no timer. It is an
 * ordinary queued action from then on, and the queue picks it up on the next connection.
 * Returning it here instead would re-arm the timer with a delay of zero, which fires, finds
 * the same row again, and re-arms with zero: a busy loop rather than a schedule.
 */
export async function nextDueAt(db: SqlDb): Promise<number | null> {
  const row = await db.get<{ due: number | null }>(
    'SELECT MIN(due_at) AS due FROM pending_actions WHERE due_at > ? AND attempts < ?',
    Date.now(),
    MAX_ATTEMPTS
  )
  return row?.due ?? null
}

/** Everything still scheduled for later, newest first. What the user can still call back. */
export async function listScheduled(db: SqlDb): Promise<PendingAction[]> {
  const rows = await db.all<PendingRow>(
    'SELECT * FROM pending_actions WHERE due_at IS NOT NULL AND attempts < ? ORDER BY due_at',
    MAX_ATTEMPTS
  )
  return rows.map(toAction)
}

/**
 * Everything still to be done for one account, oldest first.
 *
 * Actions that were given up on stay in the table but are not handed out again. They are
 * there to be reported, not to be retried.
 */
export async function listPendingActions(db: SqlDb, accountId: string): Promise<PendingAction[]> {
  // A scheduled action is skipped until its moment; it keeps its place in the order, so
  // anything queued after it still runs. Waiting behind a message meant for Monday would
  // hold up a flag change for three days.
  const rows = await db.all<PendingRow>(
    `SELECT * FROM pending_actions
     WHERE account_id = ? AND attempts < ? AND (due_at IS NULL OR due_at <= ?)
     ORDER BY id`,
    accountId,
    MAX_ATTEMPTS,
    Date.now()
  )
  return rows.map(toAction)
}

export async function removePendingAction(db: SqlDb, id: number): Promise<void> {
  await db.run('DELETE FROM pending_actions WHERE id = ?', id)
}

/**
 * Everything queued for a connection, across all accounts, oldest first.
 *
 * Deliberately not the scheduled ones and not the ones given up on: those two already have
 * their own list and their own way out. What is left is the set the user has no answer for
 * yet, which is the set worth being able to call back.
 */
export async function listWaitingActions(db: SqlDb): Promise<PendingAction[]> {
  const rows = await db.all<PendingRow>(
    `SELECT * FROM pending_actions
     WHERE attempts < ? AND (due_at IS NULL OR due_at <= ?)
     ORDER BY id`,
    MAX_ATTEMPTS,
    Date.now()
  )
  return rows.map(toAction)
}

/**
 * Drops one queued action and undoes what it had already changed here.
 *
 * A move marks its messages so the list can show where they are heading; that mark outlives
 * the row unless it is cleared with it, and a mark without an action is a promise nothing is
 * going to keep. Nothing has to be recalled from the server, since a queued action is by
 * definition one that never reached it.
 */
export async function cancelPendingAction(db: SqlDb, id: number, clearMoveMark: ClearMoveMark): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await tx.get<PendingRow>('SELECT * FROM pending_actions WHERE id = ?', id)
    if (!row) return

    if (row.kind === 'move') {
      const payload = JSON.parse(row.payload) as PendingMovePayload
      await clearMoveMark(tx, payload.sourceFolderId, payload.uids)
    }
    await tx.run('DELETE FROM pending_actions WHERE id = ?', id)
  })
}

/**
 * Takes these messages out of every move still waiting in this source folder.
 *
 * Called before a new decision about the same messages is recorded. Another move, or a
 * deletion. Without it the old move would run first and win; see `movePayloadWithout`.
 *
 * Deliberately not restricted to actions that are still eligible to run: one that has been
 * given up on is still sitting in the table and still reported to the user, and leaving it
 * there would keep announcing a move that no longer reflects anything.
 */
export async function dropQueuedMoves(
  db: SqlDb,
  accountId: string,
  sourceFolderId: string,
  uids: number[]
): Promise<void> {
  // The rows are read inside the transaction as well. Read outside it, a move queued in between
  // would be missed, and one cancelled in between would be rewritten after it was gone.
  await db.transaction(async (tx) => {
    const rows = await tx.all<PendingRow>(
      "SELECT * FROM pending_actions WHERE account_id = ? AND kind = 'move' ORDER BY id",
      accountId
    )
    for (const row of rows) {
      const payload = JSON.parse(row.payload) as PendingMovePayload
      if (payload.sourceFolderId !== sourceFolderId) continue
      const rest = movePayloadWithout(payload, uids)
      if (rest) {
        await tx.run('UPDATE pending_actions SET payload = ? WHERE id = ?', JSON.stringify(rest), row.id)
      } else {
        await tx.run('DELETE FROM pending_actions WHERE id = ?', row.id)
      }
    }
  })
}

export async function recordPendingFailure(db: SqlDb, id: number, message: string): Promise<void> {
  await db.run(
    'UPDATE pending_actions SET attempts = attempts + 1, last_error = ? WHERE id = ?',
    message.slice(0, 500),
    id
  )
}

/**
 * Clears what was given up on. The only way out of the list once it is reported.
 *
 * Messages waiting on a discarded move lose their mark here rather than in the caller. The
 * mark exists only to explain a queued action; one that outlives its action would keep
 * promising a move that is never coming, and this is the single place that knows which
 * actions are going away.
 */
export async function discardFailedActions(
  db: SqlDb,
  clearMoveMark: ClearMoveMark,
  accountId?: string
): Promise<void> {
  await db.transaction(async (tx) => {
    const failed = accountId
      ? await tx.all<PendingRow>(
          "SELECT * FROM pending_actions WHERE attempts >= ? AND account_id = ? AND kind = 'move'",
          MAX_ATTEMPTS,
          accountId
        )
      : await tx.all<PendingRow>(
          "SELECT * FROM pending_actions WHERE attempts >= ? AND kind = 'move'",
          MAX_ATTEMPTS
        )

    for (const row of failed) {
      const payload = JSON.parse(row.payload) as PendingMovePayload
      await clearMoveMark(tx, payload.sourceFolderId, payload.uids)
    }

    if (accountId) {
      await tx.run(
        'DELETE FROM pending_actions WHERE attempts >= ? AND account_id = ?',
        MAX_ATTEMPTS,
        accountId
      )
      return
    }
    await tx.run('DELETE FROM pending_actions WHERE attempts >= ?', MAX_ATTEMPTS)
  })
}

export async function pendingSummary(db: SqlDb): Promise<PendingSummary> {
  // The grouping expression has to be selected as well, otherwise `attempts` would be an
  // arbitrary row out of each group rather than the thing that was grouped on.
  const rows = await db.all<{
    kind: string
    gaveUp: number
    later: number | null
    count: number
  }>(
    `SELECT kind, attempts >= ? AS gaveUp, due_at > ? AS later, COUNT(*) AS count
     FROM pending_actions GROUP BY kind, gaveUp, later`,
    MAX_ATTEMPTS,
    Date.now()
  )

  const summary = emptySummary()
  for (const row of rows) {
    if (row.gaveUp === 1) {
      summary.failed += row.count
      continue
    }
    // A message whose moment has not come is planned, not stuck. It is counted apart and
    // deliberately left out of `total`, which is what the "waiting for a connection" chip
    // shows.
    if (row.later === 1) {
      summary.scheduled += row.count
      continue
    }
    summary.total += row.count
    const kind = row.kind as PendingActionKind
    if (kind in summary.byKind) summary.byKind[kind] += row.count
  }
  return summary
}
