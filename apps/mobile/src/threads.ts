import type { SqlDb } from '@peregrine/core/sqlDb'
import { filterMessages, type ListFilter } from './listFilter'
import { sortMessages, type ListSort } from './listSort'

/** What threading needs of a message. */
export interface Threadable {
  subject: string
  messageId: string | null
  inReplyTo: string | null
  dateMs: number | null
  flags: string[]
}

/** The messages of one conversation, the newest first, with what a list says of it in one row. */
export interface Thread<T> {
  /** The newest message: the one the row is made from, and what a swipe or a tap on the row is about. */
  newest: T
  /** All of them, the newest first. */
  messages: T[]
  /** How many are not read. */
  unread: number
}

/** The front of a subject that says it is an answer or a forward, in the languages the desktop has: `Re:`, `Fwd:`, `AW:`, `WG:`, `RE :`, `Re[2]:`, and what repeats. */
const PREFIX = /^\s*(?:(?:re|fwd?|aw|wg|sv|vs|tr|rv|enc|res|rif)(?:\[\d+\])?\s*:\s*)+/i

/** The subject without what makes it an answer, lower case, for comparing. */
export function threadSubject(subject: string): string {
  return subject.replace(PREFIX, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/** Whether the subject says that it is an answer or a forward. */
export function isReplySubject(subject: string): boolean {
  return PREFIX.test(subject)
}

/** `<id@host>` without the brackets and in lower case, which is how a Message-ID is compared. */
const normalId = (id: string | null): string | null => {
  const text = id?.trim().replace(/^<|>$/g, '').toLowerCase()
  return text ? text : null
}

/** A forest of sets, for joining what belongs together. */
class Sets {
  private readonly parent: number[]
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index)
  }
  find(index: number): number {
    let root = index
    while (this.parent[root] !== root) root = this.parent[root]
    // The way is shortened for the next time.
    let step = index
    while (this.parent[step] !== root) {
      const next = this.parent[step]
      this.parent[step] = root
      step = next
    }
    return root
  }
  join(a: number, b: number): void {
    this.parent[this.find(a)] = this.find(b)
  }
}

/**
 * Groups messages into conversations, in the order of the newest message of each.
 *
 * Two ways of belonging together. The sure one: a message names the one it answers (`In-Reply-To`), and the answers to that one, and the one it answers, are
 * one conversation, however long the chain. The other is for what the first cannot see, since a message that was not fetched leaves a hole in the chain and a
 * client that does not write the header leaves none: messages that have the same subject, once what makes it an answer is taken off, belong together when
 * at least one of them says that it is an answer. Two messages that are both first messages with the same subject are two conversations (a newsletter
 * every week is not one conversation), and a subject that is empty joins nothing.
 *
 * `list` is in whatever order the caller has; each conversation's messages are sorted by date, the newest first, and a message without a date is the oldest.
 */
export function groupThreads<T extends Threadable>(list: readonly T[]): Thread<T>[] {
  const sets = new Sets(list.length)
  const byId = new Map<string, number>()
  list.forEach((message, index) => {
    const id = normalId(message.messageId)
    if (id && !byId.has(id)) byId.set(id, index)
  })
  list.forEach((message, index) => {
    const parent = normalId(message.inReplyTo)
    const at = parent === null ? undefined : byId.get(parent)
    if (at !== undefined && at !== index) sets.join(index, at)
  })
  const bySubject = new Map<string, number[]>()
  list.forEach((message, index) => {
    const key = threadSubject(message.subject)
    if (key !== '') bySubject.set(key, [...(bySubject.get(key) ?? []), index])
  })
  for (const indexes of bySubject.values()) {
    if (indexes.length < 2 || !indexes.some((index) => isReplySubject(list[index].subject))) continue
    for (const index of indexes.slice(1)) sets.join(indexes[0], index)
  }

  const groups = new Map<number, T[]>()
  list.forEach((message, index) => {
    const root = sets.find(index)
    groups.set(root, [...(groups.get(root) ?? []), message])
  })
  const newestFirst = (a: T, b: T): number => (b.dateMs ?? -Infinity) - (a.dateMs ?? -Infinity) || 0
  return [...groups.values()]
    .map((messages): Thread<T> => {
      // A stable sort keeps the order of the list for what has the same date.
      const sorted = [...messages].sort(newestFirst)
      return { newest: sorted[0], messages: sorted, unread: sorted.filter((message) => !message.flags.some((flag) => flag.toLowerCase() === '\\seen')).length }
    })
    .sort((a, b) => newestFirst(a.newest, b.newest))
}

/** A row of a list: the message it is made from, and the conversation it is the newest of. */
export interface ConversationRow<T> {
  message: T
  /** How many messages the conversation has: one for a message that stands alone, or when conversations are off. */
  count: number
  /** Whether any of them is not read, which the row says by being bold. */
  unread: boolean
  /** All of them, the newest first. */
  messages: T[]
}

/** What a list needs of a message besides what threading needs. */
type Listed = Threadable & { uid: number; dateMs: number | null; sender: string; size: number; hasAttachment: boolean }

/**
 * The rows of a list. With conversations off: the messages, filtered and ordered. With them on: the conversations that have a message the filters
 * leave, ordered by their newest message, each one row. A filter is asked of the conversation and not of its newest message, so that "not read" finds a
 * conversation with one message not read in it, which is what somebody looking for it means.
 */
export function conversationRows<T extends Listed>(messages: readonly T[], filter: ListFilter, sort: ListSort, conversations: boolean): ConversationRow<T>[] {
  if (!conversations) {
    return sortMessages(filterMessages(messages, filter), sort).map((message) => ({ message, count: 1, unread: false, messages: [message] }))
  }
  const kept = groupThreads(messages).filter((thread) => filterMessages(thread.messages, filter).length > 0)
  const rows = new Map(kept.map((thread) => [thread.newest, thread]))
  return sortMessages([...rows.keys()], sort).map((newest) => {
    const thread = rows.get(newest) as Thread<T>
    return { message: newest, count: thread.messages.length, unread: thread.unread > 0, messages: thread.messages }
  })
}

const NAME = 'conversations'

/** Whether replies are grouped into conversations: on until the user says otherwise, which is what a mailbox of replies is read as. */
export async function loadConversations(db: SqlDb): Promise<boolean> {
  const row = await db.get<{ value: string }>('SELECT value FROM settings WHERE name = ?', NAME)
  if (!row) return true
  try {
    const on = (JSON.parse(row.value) as { on?: unknown } | null)?.on
    return typeof on === 'boolean' ? on : true
  } catch {
    return true
  }
}

export async function saveConversations(db: SqlDb, on: boolean): Promise<boolean> {
  await db.run(
    `INSERT INTO settings (name, value) VALUES (?, ?)
     ON CONFLICT (name) DO UPDATE SET value = excluded.value`,
    NAME,
    JSON.stringify({ on })
  )
  return on
}
