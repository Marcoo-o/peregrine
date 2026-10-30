import { describe, expect, it } from 'vitest'
import { NO_FILTER } from './listFilter'
import { conversationRows, groupThreads, isReplySubject, loadConversations, saveConversations, threadSubject, type Threadable } from './threads'
import { migratedDatabase } from './testing/testDb'

let counter = 0
const message = (over: Partial<Threadable> & { id?: string } = {}): Threadable & { id: string } => {
  counter++
  return { id: over.id ?? `m${counter}`, subject: 's', messageId: null, inReplyTo: null, dateMs: counter * 1000, flags: ['\\Seen'], ...over }
}
const ids = (threads: Array<{ messages: Array<{ id: string }> }>) => threads.map((thread) => thread.messages.map((m) => m.id))

describe('the subject of a conversation', () => {
  it('has no "Re:" or "Fwd:" in front, in the languages of the desktop, however many', () => {
    for (const subject of ['Re: Budget', 'RE: Budget', 'AW: Budget', 'Fwd: Re: Budget', 'WG: AW: Budget', 'Re[2]: Budget', 'SV: Budget', 'Budget']) {
      expect(threadSubject(subject)).toBe('budget')
    }
    expect(threadSubject('  Re:   many   spaces ')).toBe('many spaces')
  })

  it('says whether it is an answer', () => {
    expect(isReplySubject('Re: x')).toBe(true)
    expect(isReplySubject('Fwd: x')).toBe(true)
    expect(isReplySubject('Reminder: x')).toBe(false)
    expect(isReplySubject('Revenue')).toBe(false)
  })
})

describe('grouping messages into conversations', () => {
  it('joins an answer to the message it names, and what answers that, however long the chain', () => {
    const a = message({ id: 'a', messageId: '<1@x>', subject: 'Plan', dateMs: 1000 })
    const b = message({ id: 'b', messageId: '<2@x>', inReplyTo: '<1@x>', subject: 'Other words', dateMs: 2000 })
    const c = message({ id: 'c', messageId: '<3@x>', inReplyTo: '<2@x>', subject: 'More', dateMs: 3000 })
    const lone = message({ id: 'z', messageId: '<9@x>', subject: 'Alone', dateMs: 500 })
    expect(ids(groupThreads([a, lone, c, b]))).toEqual([['c', 'b', 'a'], ['z']])
  })

  it('compares the ids without brackets and without regard to case', () => {
    const a = message({ id: 'a', messageId: '<ABC@x>', dateMs: 1 })
    const b = message({ id: 'b', inReplyTo: 'abc@x', subject: 'z', dateMs: 2 })
    expect(ids(groupThreads([a, b]))).toEqual([['b', 'a']])
  })

  it('joins by the subject when one of them says it is an answer, when the chain has a hole', () => {
    const first = message({ id: 'a', subject: 'Budget', dateMs: 1000 })
    const answer = message({ id: 'b', subject: 'Re: Budget', inReplyTo: '<gone@x>', dateMs: 2000 })
    const another = message({ id: 'c', subject: 'AW: Budget', dateMs: 3000 })
    expect(ids(groupThreads([first, answer, another]))).toEqual([['c', 'b', 'a']])
  })

  it('keeps two first messages with the same subject apart, which is a newsletter every week', () => {
    const one = message({ id: 'a', subject: 'Weekly news', dateMs: 1000 })
    const two = message({ id: 'b', subject: 'Weekly news', dateMs: 2000 })
    expect(ids(groupThreads([one, two]))).toEqual([['b'], ['a']])
  })

  it('joins nothing by an empty subject, and a different subject is a different conversation', () => {
    const a = message({ id: 'a', subject: '', dateMs: 1 })
    const b = message({ id: 'b', subject: 'Re: ', dateMs: 2 })
    const c = message({ id: 'c', subject: 'Re: Budget', dateMs: 3 })
    const d = message({ id: 'd', subject: 'Budget plan', dateMs: 4 })
    expect(ids(groupThreads([a, b, c, d]))).toEqual([['d'], ['c'], ['b'], ['a']])
  })

  it('is in the order of the newest message of each, and a message without a date is the oldest of its conversation', () => {
    const a = message({ id: 'a', messageId: '<1@x>', dateMs: null })
    const b = message({ id: 'b', inReplyTo: '<1@x>', subject: 'x', dateMs: 5 })
    const other = message({ id: 'c', subject: 'y', dateMs: 9 })
    const grouped = groupThreads([a, b, other])
    expect(ids(grouped)).toEqual([['c'], ['b', 'a']])
    expect(grouped[1].newest.id).toBe('b')
  })

  it('counts what is not read, whatever the case of the flag', () => {
    const a = message({ id: 'a', messageId: '<1@x>', flags: ['\\seen'], dateMs: 1 })
    const b = message({ id: 'b', inReplyTo: '<1@x>', flags: [], dateMs: 2 })
    const c = message({ id: 'c', inReplyTo: '<1@x>', flags: ['\\Flagged'], dateMs: 3 })
    expect(groupThreads([a, b, c])[0].unread).toBe(2)
  })

  it('does not join a message with itself, a loop of answers, or an id that two messages have', () => {
    const self = message({ id: 'a', messageId: '<1@x>', inReplyTo: '<1@x>', subject: 'one', dateMs: 1 })
    const x = message({ id: 'b', messageId: '<2@x>', inReplyTo: '<3@x>', subject: 'two', dateMs: 2 })
    const y = message({ id: 'c', messageId: '<3@x>', inReplyTo: '<2@x>', subject: 'three', dateMs: 3 })
    expect(ids(groupThreads([self, x, y]))).toEqual([['c', 'b'], ['a']])
    const twin1 = message({ id: 'd', messageId: '<7@x>', subject: 'a', dateMs: 4 })
    const twin2 = message({ id: 'e', messageId: '<7@x>', subject: 'b', dateMs: 5 })
    const reply = message({ id: 'f', inReplyTo: '<7@x>', subject: 'c', dateMs: 6 })
    expect(groupThreads([twin1, twin2, reply]).flatMap((thread) => thread.messages)).toHaveLength(3)
  })

  it('is nothing for nothing, and leaves the list it was given as it is', () => {
    expect(groupThreads([])).toEqual([])
    const list = [message({ id: 'a', dateMs: 1 }), message({ id: 'b', dateMs: 2, subject: 'q' })]
    const before = [...list]
    groupThreads(list)
    expect(list).toEqual(before)
  })
})

/** What a list needs of a message. */
const listed = (over: Partial<Threadable & { id: string; uid: number; sender: string; size: number; hasAttachment: boolean }> = {}) => ({
  ...message(over),
  uid: over.uid ?? counter,
  sender: 'x@example.net',
  size: 1,
  hasAttachment: false,
  ...over
})
const rowIds = (rows: Array<{ message: { id: string } }>) => rows.map((row) => row.message.id)
const DATE_DESC = { field: 'date', direction: 'desc' } as const

describe('the rows of a list', () => {
  const a = listed({ id: 'a', messageId: '<1@x>', subject: 'Plan', dateMs: 1000, flags: ['\\Seen'] })
  const b = listed({ id: 'b', messageId: '<2@x>', inReplyTo: '<1@x>', subject: 'Re: Plan', dateMs: 2000, flags: [] })
  const c = listed({ id: 'c', subject: 'Lunch', dateMs: 3000, flags: ['\\Seen'] })

  it('is a row for each message when conversations are off', () => {
    const rows = conversationRows([a, b, c], NO_FILTER, DATE_DESC, false)
    expect(rowIds(rows)).toEqual(['c', 'b', 'a'])
    expect(rows.map((row) => row.count)).toEqual([1, 1, 1])
  })

  it('is a row for each conversation when they are on: its newest message, how many there are, and whether any is not read', () => {
    const rows = conversationRows([a, b, c], NO_FILTER, DATE_DESC, true)
    expect(rowIds(rows)).toEqual(['c', 'b'])
    expect(rows.map((row) => [row.count, row.unread])).toEqual([[1, false], [2, true]])
    expect(rows[1].messages.map((m) => m.id)).toEqual(['b', 'a'])
  })

  it('is ordered as the user chose, by the newest message of each conversation', () => {
    expect(rowIds(conversationRows([a, b, c], NO_FILTER, { field: 'date', direction: 'asc' }, true))).toEqual(['b', 'c'])
    expect(rowIds(conversationRows([a, b, c], NO_FILTER, { field: 'subject', direction: 'asc' }, true))).toEqual(['c', 'b'])
  })

  it('asks a filter of the conversation, so that "not read" finds one that has a message not read in it, whichever it is', () => {
    const olderUnread = listed({ id: 'd', messageId: '<5@x>', subject: 'Trip', dateMs: 1, flags: [] })
    const newerRead = listed({ id: 'e', inReplyTo: '<5@x>', subject: 'Re: Trip', dateMs: 2, flags: ['\\Seen'] })
    const rows = conversationRows([olderUnread, newerRead, c], { ...NO_FILTER, unread: true }, DATE_DESC, true)
    expect(rowIds(rows)).toEqual(['e'])
    expect(rows[0].unread).toBe(true)
  })

  it('is nothing for nothing', () => {
    expect(conversationRows([], NO_FILTER, DATE_DESC, true)).toEqual([])
  })
})

describe('whether replies are grouped', () => {
  it('is on until the user says otherwise, and what they said after', async () => {
    const { db } = await migratedDatabase()
    expect(await loadConversations(db)).toBe(true)
    await saveConversations(db, false)
    expect(await loadConversations(db)).toBe(false)
    await db.run("UPDATE settings SET value = 'not json' WHERE name = 'conversations'")
    expect(await loadConversations(db)).toBe(true)
  })
})
