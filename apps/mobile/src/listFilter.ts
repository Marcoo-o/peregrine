import { FLAGGED, SEEN } from './flags'

/** The filters of a list, as the desktop has them above its list: what is not read, what is starred, what has a file. */
export interface ListFilter {
  unread: boolean
  starred: boolean
  attachments: boolean
}

export const NO_FILTER: ListFilter = { unread: false, starred: false, attachments: false }

const hasFlag = (flags: string[], flag: string): boolean => flags.some((candidate) => candidate.toLowerCase() === flag.toLowerCase())

/** What of a list is left by the filters that are on. Each one narrows further, and the order of the list is kept. */
export function filterMessages<T extends { flags: string[]; hasAttachment: boolean }>(messages: readonly T[], filter: ListFilter): T[] {
  return messages.filter(
    (message) =>
      (!filter.unread || !hasFlag(message.flags, SEEN)) &&
      (!filter.starred || hasFlag(message.flags, FLAGGED)) &&
      (!filter.attachments || message.hasAttachment)
  )
}

/** How many messages a list has, as a line for its top. `of` is how many there are before a filter took some away. */
export function countText(count: number, of: number = count): string {
  const noun = count === 1 ? 'Nachricht' : 'Nachrichten'
  if (count === 0 && of === 0) return 'Keine Nachrichten'
  return count === of ? `${count} ${noun}` : `${count} von ${of} Nachrichten`
}
