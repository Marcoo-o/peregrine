import type { MessageSummary } from '@peregrine/core/types'

export interface ThreadNode {
  message: MessageSummary
  /** 0 for the conversation root, 1 for a direct reply, and so on. */
  depth: number
}

export interface Thread {
  /** Stable id of the conversation. The root message's id. */
  id: string
  nodes: ThreadNode[]
  /** Newest message in the conversation; conversations sort by this. */
  latestDate: string
  unreadCount: number
}

/** Strips reply/forward prefixes so a renamed thread still groups. */
export function normalizeSubject(subject: string): string {
  return subject
    .replace(/^(\s*(re|aw|antw|fwd|fw|wg)\s*(\[\d+\])?\s*:\s*)+/i, '')
    .trim()
    .toLowerCase()
}

function referenceIds(message: MessageSummary): string[] {
  const refs = message.referencesHeader ? message.referencesHeader.split(/\s+/) : []
  if (message.inReplyTo) refs.push(message.inReplyTo)
  return refs.filter(Boolean)
}

/**
 * Groups a loaded page of messages into conversations.
 *
 * Threading is done over the messages currently loaded rather than server-side: IMAP gives no
 * thread ids, and walking every reference chain across the whole mailbox would mean fetching
 * far more than the list shows. A reply whose parent is further back than the loaded page
 * therefore starts its own conversation. Which is also what it looks like to the reader.
 */
export function buildThreads(messages: MessageSummary[]): Thread[] {
  const byMessageId = new Map<string, MessageSummary>()
  for (const message of messages) {
    if (message.messageIdHeader) byMessageId.set(message.messageIdHeader, message)
  }

  // Union-find over "replies to" plus a normalized-subject fallback for mailers that drop
  // References headers entirely.
  const parentOf = new Map<string, string>()
  const find = (id: string): string => {
    let current = id
    while (parentOf.has(current)) current = parentOf.get(current) as string
    return current
  }
  const union = (a: string, b: string): void => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parentOf.set(rootA, rootB)
  }

  const subjectRoots = new Map<string, string>()
  for (const message of messages) {
    for (const ref of referenceIds(message)) {
      const parent = byMessageId.get(ref)
      if (parent) union(message.id, parent.id)
    }
    const key = normalizeSubject(message.subject)
    if (key) {
      const existing = subjectRoots.get(key)
      if (existing) union(message.id, existing)
      else subjectRoots.set(key, message.id)
    }
  }

  const groups = new Map<string, MessageSummary[]>()
  for (const message of messages) {
    const root = find(message.id)
    const group = groups.get(root) ?? []
    group.push(message)
    groups.set(root, group)
  }

  const threads: Thread[] = []
  for (const group of groups.values()) {
    const ordered = [...group].sort((a, b) => a.date.localeCompare(b.date))
    const rootMessage = ordered[0]
    const depthOf = new Map<string, number>([[rootMessage.id, 0]])

    const nodes: ThreadNode[] = ordered.map((message) => {
      if (message.id === rootMessage.id) return { message, depth: 0 }
      const parentRef = referenceIds(message)
        .map((ref) => byMessageId.get(ref))
        .find((candidate) => candidate && depthOf.has(candidate.id))
      // Cap the indent: deep chains would otherwise push the subject out of the column.
      const depth = Math.min(3, parentRef ? (depthOf.get(parentRef.id) ?? 0) + 1 : 1)
      depthOf.set(message.id, depth)
      return { message, depth }
    })

    threads.push({
      id: rootMessage.id,
      nodes,
      latestDate: ordered[ordered.length - 1].date,
      unreadCount: ordered.filter((message) => !message.isRead).length
    })
  }

  return threads
}

/**
 * Flattens conversations back into rows for the virtualized list: collapsed conversations show
 * only their newest message, expanded ones show every reply in order.
 */
export function threadRows(
  messages: MessageSummary[],
  collapsedIds: Set<string>
): { message: MessageSummary; depth: number; threadId: string; threadSize: number }[] {
  const threads = buildThreads(messages)
  // Keep the page's own ordering (whatever column the user sorted by) rather than imposing one.
  const order = new Map(messages.map((message, index) => [message.id, index]))
  threads.sort((a, b) => {
    const aFirst = Math.min(...a.nodes.map((n) => order.get(n.message.id) ?? 0))
    const bFirst = Math.min(...b.nodes.map((n) => order.get(n.message.id) ?? 0))
    return aFirst - bFirst
  })

  return threads.flatMap((thread) => {
    if (thread.nodes.length === 1) {
      return [{ message: thread.nodes[0].message, depth: 0, threadId: thread.id, threadSize: 1 }]
    }
    const newest = thread.nodes[thread.nodes.length - 1].message
    if (collapsedIds.has(thread.id)) {
      return [{ message: newest, depth: 0, threadId: thread.id, threadSize: thread.nodes.length }]
    }
    return thread.nodes.map((node) => ({
      message: node.message,
      depth: node.depth,
      threadId: thread.id,
      threadSize: thread.nodes.length
    }))
  })
}
