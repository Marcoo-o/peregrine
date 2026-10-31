import type { SqlDb } from '@peregrine/core/sqlDb'
import { language, msg, t } from './i18n'

/** What a list is ordered by, as the desktop offers it: when, from whom, what about, how large. */
export type SortField = 'date' | 'subject' | 'from' | 'size'
export type SortDirection = 'asc' | 'desc'

/** How the lists of messages are ordered. */
export interface ListSort {
  field: SortField
  direction: SortDirection
}

/** The newest first, which is how a mailbox is read. */
export const DEFAULT_SORT: ListSort = { field: 'date', direction: 'desc' }

const FIELDS: readonly SortField[] = ['date', 'subject', 'from', 'size']

/** The choices in the order they are offered, each with the words for it: what is first, not the name of the field alone. */
export const SORT_CHOICES: ReadonlyArray<{ sort: ListSort; label: string }> = [
  { sort: { field: 'date', direction: 'desc' }, label: msg('Neueste zuerst') },
  { sort: { field: 'date', direction: 'asc' }, label: msg('Älteste zuerst') },
  { sort: { field: 'from', direction: 'asc' }, label: msg('Absender A bis Z') },
  { sort: { field: 'from', direction: 'desc' }, label: msg('Absender Z bis A') },
  { sort: { field: 'subject', direction: 'asc' }, label: msg('Betreff A bis Z') },
  { sort: { field: 'subject', direction: 'desc' }, label: msg('Betreff Z bis A') },
  { sort: { field: 'size', direction: 'desc' }, label: msg('Größte zuerst') },
  { sort: { field: 'size', direction: 'asc' }, label: msg('Kleinste zuerst') }
]

/** The words for a way of ordering. */
export function sortLabel(sort: ListSort): string {
  return t(SORT_CHOICES.find((choice) => choice.sort.field === sort.field && choice.sort.direction === sort.direction)?.label ?? SORT_CHOICES[0].label)
}

/** What orders a list needs of a message. */
interface Sortable {
  uid: number
  dateMs: number | null
  subject: string
  sender: string
  size: number
}

/** A name to order by: the name part of a sender when it has one, without quotes, else the address, without regard to case. */
function senderKey(sender: string): string {
  const name = /^\s*"?([^"<]*?)"?\s*<[^>]*>\s*$/.exec(sender)?.[1]?.trim()
  return (name || sender).toLowerCase()
}

/** A subject to order by: without "Re:" and "Fwd:" in front, which every answer would otherwise gather under R. */
function subjectKey(subject: string): string {
  return subject.replace(/^\s*((re|fwd?|aw|wg)\s*:\s*)+/i, '').trim().toLowerCase()
}

const text = (a: string, b: string): number => a.localeCompare(b, language.code, { sensitivity: 'base', numeric: true })

/**
 * The messages in the order the user chose. A copy: the list it was given is left as it is. What is equal in the field is in the order it came in,
 * the newest first, so that a list does not jump about between one sort and the next. A message without a date is the oldest.
 */
export function sortMessages<T extends Sortable>(messages: readonly T[], sort: ListSort): T[] {
  const sign = sort.direction === 'asc' ? 1 : -1
  const compare = (a: T, b: T): number => {
    switch (sort.field) {
      case 'date':
        return (a.dateMs ?? -Infinity) === (b.dateMs ?? -Infinity) ? 0 : (a.dateMs ?? -Infinity) < (b.dateMs ?? -Infinity) ? -1 : 1
      case 'subject':
        return text(subjectKey(a.subject), subjectKey(b.subject))
      case 'from':
        return text(senderKey(a.sender), senderKey(b.sender))
      case 'size':
        return a.size - b.size
    }
  }
  return [...messages].sort((a, b) => sign * compare(a, b) || b.uid - a.uid)
}

const NAME = 'sort'

/** The order as stored, with what is missing or is not a choice taking the default. */
export async function loadSort(db: SqlDb): Promise<ListSort> {
  const row = await db.get<{ value: string }>('SELECT value FROM settings WHERE name = ?', NAME)
  if (!row) return DEFAULT_SORT
  try {
    const given = JSON.parse(row.value) as Record<string, unknown> | null
    const field = FIELDS.find((candidate) => candidate === given?.field)
    const direction = given?.direction === 'asc' || given?.direction === 'desc' ? given.direction : undefined
    return field && direction ? { field, direction } : DEFAULT_SORT
  } catch {
    return DEFAULT_SORT
  }
}

export async function saveSort(db: SqlDb, sort: ListSort): Promise<ListSort> {
  await db.run(
    `INSERT INTO settings (name, value) VALUES (?, ?)
     ON CONFLICT (name) DO UPDATE SET value = excluded.value`,
    NAME,
    JSON.stringify(sort)
  )
  return sort
}
