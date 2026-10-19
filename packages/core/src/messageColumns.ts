/**
 * Which columns the message list shows, in which order and how wide.
 *
 * Stored as JSON in the settings rather than as one setting per column: the order *is* the
 * array order, and a fixed set of columns each with its own key could not express it.
 */

export type MessageColumnId = 'subject' | 'participants' | 'date' | 'size' | 'account' | 'folder'

export interface MessageColumnSpec {
  id: MessageColumnId
  /** Whether the list can be sorted by it; folder and account are display-only. */
  sortField?: 'subject' | 'from' | 'date' | 'size'
  defaultWidth: number
  /**
   * How far the column may be squeezed before it stops giving way.
   *
   * A track allowed to shrink to nothing does not make its text smaller. The text keeps its
   * size and simply runs over the next column, which is how a narrow window ended up showing
   * a date printed across the size beside it. The floors are what each column needs to stay
   * readable: a date with time, a size with its unit, a name one can recognise.
   */
  minWidth: number
  /** The subject takes the remaining space instead of a fixed width. */
  flexible?: boolean
}

export const MESSAGE_COLUMNS: Record<MessageColumnId, MessageColumnSpec> = {
  subject: { id: 'subject', sortField: 'subject', defaultWidth: 0, minWidth: 90, flexible: true },
  participants: { id: 'participants', sortField: 'from', defaultWidth: 220, minWidth: 80 },
  date: { id: 'date', sortField: 'date', defaultWidth: 150, minWidth: 100 },
  size: { id: 'size', sortField: 'size', defaultWidth: 90, minWidth: 56 },
  account: { id: 'account', defaultWidth: 140, minWidth: 70 },
  folder: { id: 'folder', defaultWidth: 140, minWidth: 70 }
}

export const DEFAULT_COLUMNS: MessageColumnId[] = ['subject', 'participants', 'date', 'size']

const MIN_WIDTH = 60
const MAX_WIDTH = 520

/**
 * Reads the stored column list, repairing anything that does not make sense.
 *
 * Unknown ids are dropped so a downgrade cannot leave the list unusable, and the subject is
 * forced back in if it is missing. A message list without subjects is not a list anyone
 * could work with, and there would be no way back to this setting from it.
 */
export function parseColumns(raw: string): MessageColumnId[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return [...DEFAULT_COLUMNS]
  }
  if (!Array.isArray(parsed)) return [...DEFAULT_COLUMNS]

  const seen = new Set<MessageColumnId>()
  const columns = parsed.filter((id): id is MessageColumnId => {
    if (typeof id !== 'string' || !(id in MESSAGE_COLUMNS) || seen.has(id as MessageColumnId)) {
      return false
    }
    seen.add(id as MessageColumnId)
    return true
  })

  if (!columns.includes('subject')) columns.unshift('subject')
  return columns
}

export function parseColumnWidths(raw: string): Partial<Record<MessageColumnId, number>> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null) return {}

  const widths: Partial<Record<MessageColumnId, number>> = {}
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!(id in MESSAGE_COLUMNS) || typeof value !== 'number' || !Number.isFinite(value)) continue
    widths[id as MessageColumnId] = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value))
  }
  return widths
}

export function widthOf(
  id: MessageColumnId,
  widths: Partial<Record<MessageColumnId, number>>
): number {
  return widths[id] ?? MESSAGE_COLUMNS[id].defaultWidth
}

export { MIN_WIDTH as COLUMN_MIN_WIDTH, MAX_WIDTH as COLUMN_MAX_WIDTH }
