import type { SqlDb } from '../sqlDb'
import { randomUUID } from 'node:crypto'
import type {
  DailyMail,
  DailyTask,
  Task,
  TaskInput,
  TaskItem,
  TaskMessageLink
} from '@peregrine/core/types'
import { occursOn, parseRecurrence } from '@peregrine/core/recurrence'

interface TaskRow {
  id: string
  title: string
  notes: string
  recurrence: string
  start_day: string
  sort_order: number
  account_id: string | null
  folder_id: string | null
  uid: number | null
  message_id_header: string | null
}

interface ItemRow {
  id: string
  task_id: string
  title: string
  done_on: string | null
  sort_order: number
}

function linkOf(row: TaskRow): TaskMessageLink | null {
  if (!row.account_id || !row.folder_id || row.uid === null) return null
  return {
    accountId: row.account_id,
    folderId: row.folder_id,
    uid: row.uid,
    messageIdHeader: row.message_id_header
  }
}

function toTask(row: TaskRow, items: TaskItem[]): Task {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    recurrence: row.recurrence,
    startDay: row.start_day,
    sortOrder: row.sort_order,
    link: linkOf(row),
    items
  }
}

async function itemsByTask(db: SqlDb, taskIds: string[]): Promise<Map<string, TaskItem[]>> {
  const byTask = new Map<string, TaskItem[]>()
  if (taskIds.length === 0) return byTask
  const rows = await db.all<ItemRow>(
    `SELECT * FROM task_items WHERE task_id IN (${taskIds.map(() => '?').join(', ')})
     ORDER BY sort_order, rowid`,
    ...taskIds
  )
  for (const row of rows) {
    const list = byTask.get(row.task_id) ?? []
    list.push({ id: row.id, title: row.title, doneOn: row.done_on })
    byTask.set(row.task_id, list)
  }
  return byTask
}

export async function createTask(
  db: SqlDb,
  input: TaskInput,
  startDay: string
): Promise<string> {
  const id = randomUUID()
  // The task and its checklist are written together. A task whose items failed half way would
  // otherwise be left behind with part of its list.
  await db.transaction(async (tx) => {
    const next = (await tx.get<{ n: number }>(
      'SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM tasks'
    ))!
    await tx.run(
      `INSERT INTO tasks
         (id, title, notes, recurrence, start_day, sort_order,
          account_id, folder_id, uid, message_id_header)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.title.trim(),
      input.notes ?? '',
      input.recurrence ?? 'once',
      startDay,
      next.n,
      input.link?.accountId ?? null,
      input.link?.folderId ?? null,
      input.link?.uid ?? null,
      input.link?.messageIdHeader ?? null
    )
    for (const [index, title] of (input.items ?? []).entries()) {
      if (title.trim()) await addTaskItem(tx, id, title, index)
    }
  })
  return id
}

export async function addTaskItem(
  db: SqlDb,
  taskId: string,
  title: string,
  sortOrder?: number
): Promise<string> {
  const id = randomUUID()
  await db.transaction(async (tx) => {
    const order =
      sortOrder ??
      (
        await tx.get<{ n: number }>(
          'SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM task_items WHERE task_id = ?',
          taskId
        )
      )!.n
    await tx.run(
      'INSERT INTO task_items (id, task_id, title, sort_order) VALUES (?, ?, ?, ?)',
      id,
      taskId,
      title.trim(),
      order
    )
  })
  return id
}

export async function updateTask(
  db: SqlDb,
  taskId: string,
  patch: { title?: string; notes?: string; recurrence?: string }
): Promise<void> {
  const sets: string[] = []
  const params: unknown[] = []
  if (patch.title !== undefined) {
    sets.push('title = ?')
    params.push(patch.title.trim())
  }
  if (patch.notes !== undefined) {
    sets.push('notes = ?')
    params.push(patch.notes)
  }
  if (patch.recurrence !== undefined) {
    sets.push('recurrence = ?')
    params.push(patch.recurrence)
  }
  if (sets.length === 0) return
  params.push(taskId)
  await db.run(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, ...params)
}

export async function deleteTask(db: SqlDb, taskId: string): Promise<void> {
  await db.run('DELETE FROM tasks WHERE id = ?', taskId)
}

/**
 * Puts the list in the order the user dragged it into.
 *
 * `sort_order` was in the table from the start and read by every query, but nothing ever
 * wrote it. So the order was creation order wearing a sortable column. Positions are
 * rewritten from scratch rather than nudged, because gaps and ties accumulate otherwise and
 * the tie-break (`rowid`) would quietly take over.
 */
export async function reorderTasks(db: SqlDb, taskIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (const [index, taskId] of taskIds.entries()) {
      await tx.run('UPDATE tasks SET sort_order = ? WHERE id = ?', index, taskId)
    }
  })
}

/**
 * Moves a one-off task to another day.
 *
 * Only for `once`: for a repeating task the rule decides when it comes back, and rewriting
 * `start_day` would not postpone today's instance. It would shift every future one. Pushing
 * a single occurrence of a recurring task is a different feature and would need its own
 * table of exceptions; pretending this button does it would be worse than not offering it.
 */
export async function deferTask(db: SqlDb, taskId: string, toDay: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const row = await tx.get<{ recurrence: string }>(
      'SELECT recurrence FROM tasks WHERE id = ?',
      taskId
    )
    if (!row || row.recurrence !== 'once') return false

    await tx.run('UPDATE tasks SET start_day = ? WHERE id = ?', toDay, taskId)
    // A task that was ticked today and is then moved on would arrive already done.
    await tx.run('DELETE FROM task_completions WHERE task_id = ?', taskId)
    // Same for its checklist: yesterday's ticks are not tomorrow's progress.
    await tx.run('UPDATE task_items SET done_on = NULL WHERE task_id = ?', taskId)
    return true
  })
}

export async function deleteTaskItem(db: SqlDb, itemId: string): Promise<void> {
  await db.run('DELETE FROM task_items WHERE id = ?', itemId)
}

/** `done` is per day: ticking writes the day, unticking clears it. */
export async function setTaskItemDone(
  db: SqlDb,
  itemId: string,
  dayKey: string | null
): Promise<void> {
  await db.run('UPDATE task_items SET done_on = ? WHERE id = ?', dayKey, itemId)
}

export async function setTaskDone(
  db: SqlDb,
  taskId: string,
  dayKey: string,
  done: boolean
): Promise<void> {
  if (done) {
    await db.run(
      'INSERT OR IGNORE INTO task_completions (task_id, occurred_on) VALUES (?, ?)',
      taskId,
      dayKey
    )
    return
  }
  await db.run(
    'DELETE FROM task_completions WHERE task_id = ? AND occurred_on = ?',
    taskId,
    dayKey
  )
}

/**
 * The stored tasks that belong to one day.
 *
 * Every task is asked whether its rule covers this day; nothing is precomputed. With a few
 * hundred tasks that is a walk over a small table, and it keeps the table free of rows that
 * only exist to be deleted later.
 */
export async function listTasksForDay(db: SqlDb, dayKey: string): Promise<DailyTask[]> {
  const rows = await db.all<TaskRow>('SELECT * FROM tasks ORDER BY sort_order, rowid')
  const due = rows.filter((row) => occursOn(parseRecurrence(row.recurrence), dayKey, row.start_day))
  const items = await itemsByTask(db, due.map((row) => row.id))

  const completed = new Set(
    (
      await db.all<{ task_id: string }>(
        'SELECT task_id FROM task_completions WHERE occurred_on = ?',
        dayKey
      )
    ).map((row) => row.task_id)
  )

  return due.map((row) => ({
    ...toTask(row, items.get(row.id) ?? []),
    done: completed.has(row.id)
  }))
}

/**
 * Where a task's message is *now*.
 *
 * The stored folder and uid are the fast path and the first thing tried. They stop being
 * true the moment the message is moved, because a uid belongs to one folder, which is why the
 * Message-ID was stored alongside them. It is the part that survives moving, archiving and
 * being filed by a rule, and looking it up is what turns a dead link back into a live one.
 *
 * The search is limited to the account the task was made in: Message-IDs are meant to be
 * globally unique, but the same message can sit in several mailboxes, and the one the user
 * had in front of them is the one they mean.
 */
export async function resolveTaskMessage(
  db: SqlDb,
  link: TaskMessageLink
): Promise<{ accountId: string; folderId: string; uid: number } | null> {
  const direct = await db.get(
    'SELECT 1 FROM messages WHERE folder_id = ? AND uid = ?',
    link.folderId,
    link.uid
  )
  if (direct) return { accountId: link.accountId, folderId: link.folderId, uid: link.uid }

  if (!link.messageIdHeader) return null
  const moved = await db.get<{ account_id: string; folder_id: string; uid: number }>(
    `SELECT account_id, folder_id, uid FROM messages
     WHERE message_id_header = ? AND account_id = ?
     ORDER BY rowid DESC LIMIT 1`,
    link.messageIdHeader,
    link.accountId
  )
  if (!moved) return null
  return { accountId: moved.account_id, folderId: moved.folder_id, uid: moved.uid }
}

interface MailRow {
  account_id: string
  folder_id: string
  uid: number
  subject: string | null
  from_name: string | null
  from_address: string | null
  date: string | null
}

/**
 * Messages that are on the list because they carry the configured keyword.
 *
 * Read fresh every time rather than copied into a task row: the tag on the server is the
 * truth. A stored copy would stay behind the moment the tag is removed on the phone, and
 * the list would show work that is already done.
 *
 * The keyword is matched as a fully quoted element of the stored JSON array. The same way
 * the message filters do it. Without the quotes "Projekt" would also match "ProjektX".
 */
export async function listTaggedMails(db: SqlDb, keyword: string): Promise<DailyMail[]> {
  if (!keyword) return []
  const rows = await db.all<MailRow>(
    `SELECT account_id, folder_id, uid, subject, from_name, from_address, date
     FROM messages
     WHERE flags LIKE '%"' || ? || '"%'
       AND (snoozed_until IS NULL OR snoozed_until <= ?)
     ORDER BY date DESC
     LIMIT 200`,
    keyword,
    Date.now()
  )

  return rows.map((row) => ({
    accountId: row.account_id,
    folderId: row.folder_id,
    uid: row.uid,
    subject: row.subject ?? '',
    fromName: row.from_name ?? '',
    fromAddress: row.from_address ?? '',
    date: row.date ?? ''
  }))
}

export async function getTask(db: SqlDb, taskId: string): Promise<Task | null> {
  const row = await db.get<TaskRow>('SELECT * FROM tasks WHERE id = ?', taskId)
  if (!row) return null
  return toTask(row, (await itemsByTask(db, [row.id])).get(row.id) ?? [])
}

/**
 * Removes finished one-off tasks once their day has passed.
 *
 * Only one-offs, and only completed ones: a recurring task keeps its completions as its
 * history, and an unfinished one-off is exactly the thing nobody wants quietly removed.
 */
export async function pruneFinishedTasks(db: SqlDb, beforeDay: string): Promise<number> {
  const result = await db.run(
    `DELETE FROM tasks WHERE recurrence = 'once' AND start_day < ?
       AND id IN (SELECT task_id FROM task_completions)`,
    beforeDay
  )
  return result.changes
}
