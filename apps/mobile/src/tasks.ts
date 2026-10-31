import { occursOn, parseRecurrence, serializeRecurrence, toDayKey, fromDayKey, type Recurrence } from '@peregrine/core/recurrence'
import type { SqlDb } from '@peregrine/core/sqlDb'
import { newId } from './ids'
import { msg } from './i18n'

/**
 * The daily list, as the desktop has it: a task is a rule (what, and how often) and the days it was finished on; what is due on a day is worked out from the
 * rule and the clock (`@peregrine/core/recurrence`), nothing is written for days that have not come. A checklist item is ticked for a day and is open again the next.
 * A task made from a message keeps where the message is and its Message-ID, so that it can be found again when the message has been moved.
 */

export interface TaskLink {
  accountId: string
  folderId: string
  uid: number
  messageId: string | null
}

export interface TaskItem {
  id: string
  title: string
  /** The day it was ticked, or null. */
  doneOn: string | null
}

export interface Task {
  id: string
  title: string
  notes: string
  recurrence: string
  startDay: string
  link: TaskLink | null
  items: TaskItem[]
}

/** One task on a day, and whether it was finished on that day. */
export interface DayTask extends Task {
  done: boolean
}

/** The ways a task can come back, with their words. Weekly and monthly are of the weekday and the day of the month of the day the task is made on. */
export const REPEATS: ReadonlyArray<{ kind: Recurrence['kind']; label: string }> = [
  { kind: 'once', label: msg('Einmal') },
  { kind: 'daily', label: msg('Täglich') },
  { kind: 'weekdays', label: msg('Werktags') },
  { kind: 'weekly', label: msg('Wöchentlich') },
  { kind: 'monthly', label: msg('Monatlich') }
]

/** The rule for a kind of repetition, from the day the task starts on. */
export function ruleFor(kind: Recurrence['kind'], dayKey: string): string {
  const date = fromDayKey(dayKey) ?? new Date()
  if (kind === 'weekly') return serializeRecurrence({ kind, weekday: date.getDay() })
  if (kind === 'monthly') return serializeRecurrence({ kind, day: date.getDate() })
  return serializeRecurrence({ kind } as Recurrence)
}

export const today = (now: Date = new Date()): string => toDayKey(now)

export const tomorrow = (now: Date = new Date()): string => {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return toDayKey(next)
}

interface TaskRow {
  id: string
  title: string
  notes: string
  recurrence: string
  start_day: string
  account_id: string | null
  folder_id: string | null
  uid: number | null
  message_id: string | null
}

interface ItemRow {
  id: string
  task_id: string
  title: string
  done_on: string | null
}

const linkOf = (row: TaskRow): TaskLink | null =>
  row.account_id && row.folder_id && row.uid !== null ? { accountId: row.account_id, folderId: row.folder_id, uid: row.uid, messageId: row.message_id } : null

async function withItems(db: SqlDb, rows: TaskRow[]): Promise<Task[]> {
  if (rows.length === 0) return []
  const items = await db.all<ItemRow>(
    `SELECT id, task_id, title, done_on FROM task_items WHERE task_id IN (${rows.map(() => '?').join(', ')}) ORDER BY sort_order, rowid`,
    ...rows.map((row) => row.id)
  )
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    notes: row.notes,
    recurrence: row.recurrence,
    startDay: row.start_day,
    link: linkOf(row),
    items: items.filter((item) => item.task_id === row.id).map((item) => ({ id: item.id, title: item.title, doneOn: item.done_on }))
  }))
}

export interface NewTask {
  title: string
  notes?: string
  recurrence?: string
  link?: TaskLink | null
  items?: string[]
}

/** Keeps a task that starts on a day. Nothing is kept for an empty title. */
export async function addTask(db: SqlDb, input: NewTask, startDay: string): Promise<{ id: string } | { problem: 'empty' }> {
  const title = input.title.replace(/\s+/g, ' ').trim()
  if (title === '') return { problem: 'empty' }
  const id = newId()
  await db.transaction(async (tx) => {
    const next = await tx.get<{ n: number }>('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM tasks')
    await tx.run(
      `INSERT INTO tasks (id, title, notes, recurrence, start_day, sort_order, account_id, folder_id, uid, message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      title,
      input.notes ?? '',
      input.recurrence ?? 'once',
      startDay,
      next?.n ?? 1,
      input.link?.accountId ?? null,
      input.link?.folderId ?? null,
      input.link?.uid ?? null,
      input.link?.messageId ?? null
    )
    for (const [index, item] of (input.items ?? []).entries()) {
      if (item.trim() !== '') await tx.run('INSERT INTO task_items (id, task_id, title, sort_order) VALUES (?, ?, ?, ?)', newId(), id, item.trim(), index)
    }
  })
  return { id }
}

/** The tasks that are due on a day, in the order they were put in, with whether each was finished on it. */
export async function tasksForDay(db: SqlDb, dayKey: string): Promise<DayTask[]> {
  const rows = await db.all<TaskRow>(
    'SELECT id, title, notes, recurrence, start_day, account_id, folder_id, uid, message_id FROM tasks ORDER BY sort_order, rowid'
  )
  const due = rows.filter((row) => occursOn(parseRecurrence(row.recurrence), dayKey, row.start_day))
  const finished = new Set((await db.all<{ task_id: string }>('SELECT task_id FROM task_completions WHERE occurred_on = ?', dayKey)).map((row) => row.task_id))
  return (await withItems(db, due)).map((task) => ({ ...task, done: finished.has(task.id) }))
}

export async function setTaskDone(db: SqlDb, id: string, dayKey: string, done: boolean): Promise<void> {
  if (done) await db.run('INSERT OR IGNORE INTO task_completions (task_id, occurred_on) VALUES (?, ?)', id, dayKey)
  else await db.run('DELETE FROM task_completions WHERE task_id = ? AND occurred_on = ?', id, dayKey)
}

/** Ticks an item for a day, or opens it again. */
export async function setItemDone(db: SqlDb, itemId: string, dayKey: string | null): Promise<void> {
  await db.run('UPDATE task_items SET done_on = ? WHERE id = ?', dayKey, itemId)
}

export async function addItem(db: SqlDb, taskId: string, title: string): Promise<boolean> {
  const text = title.replace(/\s+/g, ' ').trim()
  if (text === '') return false
  const next = await db.get<{ n: number }>('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM task_items WHERE task_id = ?', taskId)
  await db.run('INSERT INTO task_items (id, task_id, title, sort_order) VALUES (?, ?, ?, ?)', newId(), taskId, text, next?.n ?? 1)
  return true
}

export async function removeItem(db: SqlDb, itemId: string): Promise<void> {
  await db.run('DELETE FROM task_items WHERE id = ?', itemId)
}

export async function removeTask(db: SqlDb, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM task_items WHERE task_id = ?', id)
    await tx.run('DELETE FROM task_completions WHERE task_id = ?', id)
    await tx.run('DELETE FROM tasks WHERE id = ?', id)
  })
}

/**
 * Moves a task that happens once to another day. A repeating task is not moved: the rule says when it comes back, and changing its start would move all the
 * days after, not this one. Whether the task was moved.
 */
export async function deferTask(db: SqlDb, id: string, toDay: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const row = await tx.get<{ recurrence: string }>('SELECT recurrence FROM tasks WHERE id = ?', id)
    if (!row || parseRecurrence(row.recurrence).kind !== 'once') return false
    await tx.run('UPDATE tasks SET start_day = ? WHERE id = ?', toDay, id)
    // What was ticked for the day it was on is not progress for the day it is moved to.
    await tx.run('DELETE FROM task_completions WHERE task_id = ?', id)
    await tx.run('UPDATE task_items SET done_on = NULL WHERE task_id = ?', id)
    return true
  })
}

/** Takes away the tasks that happen once, were finished, and whose day has gone by. A repeating task keeps its days; an unfinished one is never taken. */
export async function pruneFinished(db: SqlDb, beforeDay: string): Promise<number> {
  const rows = await db.all<{ id: string }>(
    `SELECT id FROM tasks WHERE recurrence = 'once' AND start_day < ? AND id IN (SELECT task_id FROM task_completions)`,
    beforeDay
  )
  for (const { id } of rows) await removeTask(db, id)
  return rows.length
}

/**
 * Where the message of a task is now: where it was put, or, when it is not there any more, wherever the message with that Message-ID is in the account.
 * Null when it cannot be found, and the task stands as text.
 */
export async function findTaskMessage(db: SqlDb, link: TaskLink): Promise<{ accountId: string; folderId: string; uid: number } | null> {
  const direct = await db.get('SELECT 1 AS found FROM messages WHERE folder_id = ? AND uid = ?', link.folderId, link.uid)
  if (direct) return { accountId: link.accountId, folderId: link.folderId, uid: link.uid }
  if (!link.messageId) return null
  const moved = await db.get<{ account_id: string; folder_id: string; uid: number }>(
    'SELECT account_id, folder_id, uid FROM messages WHERE message_id = ? AND account_id = ? ORDER BY rowid DESC LIMIT 1',
    link.messageId,
    link.accountId
  )
  return moved ? { accountId: moved.account_id, folderId: moved.folder_id, uid: moved.uid } : null
}
