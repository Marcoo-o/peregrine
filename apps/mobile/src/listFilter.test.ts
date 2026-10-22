import { describe, expect, it } from 'vitest'
import { countText, filterMessages, NO_FILTER, type ListFilter } from './listFilter'

const message = (uid: number, over: { flags?: string[]; hasAttachment?: boolean } = {}) => ({
  uid,
  flags: over.flags ?? [],
  hasAttachment: over.hasAttachment ?? false
})

const list = [
  message(1),
  message(2, { flags: ['\\Seen'] }),
  message(3, { flags: ['\\Seen', '\\Flagged'], hasAttachment: true }),
  message(4, { hasAttachment: true }),
  message(5, { flags: ['\\FLAGGED'] })
]

const uids = (filter: ListFilter) => filterMessages(list, filter).map((m) => m.uid)

describe('the filters of a list', () => {
  it('leave everything when none is on', () => {
    expect(uids(NO_FILTER)).toEqual([1, 2, 3, 4, 5])
  })

  it('keep what is not read, what is starred, or what has an attachment', () => {
    expect(uids({ ...NO_FILTER, unread: true })).toEqual([1, 4, 5])
    expect(uids({ ...NO_FILTER, starred: true })).toEqual([3, 5])
    expect(uids({ ...NO_FILTER, attachments: true })).toEqual([3, 4])
  })

  it('narrow each other when several are on, so that what is left has every one of them', () => {
    expect(uids({ unread: true, starred: false, attachments: true, tag: null })).toEqual([4])
    expect(uids({ unread: true, starred: true, attachments: true, tag: null })).toEqual([])
  })

  it('can be narrowed to one tag, which keeps the messages that have its keyword in any case', () => {
    const tagged = [
      { flags: ['Work'], hasAttachment: false, uid: 1 },
      { flags: ['work', '\\Seen'], hasAttachment: false, uid: 2 },
      { flags: ['Other'], hasAttachment: false, uid: 3 },
      { flags: [], hasAttachment: false, uid: 4 }
    ]
    expect(filterMessages(tagged, { ...NO_FILTER, tag: 'Work' }).map((m) => m.uid)).toEqual([1, 2])
    expect(filterMessages(tagged, { ...NO_FILTER, tag: 'Nothing' })).toEqual([])
    expect(filterMessages(tagged, NO_FILTER)).toHaveLength(4)
  })

  it('narrows further with a tag together with the other filters', () => {
    const tagged = [
      { flags: ['Work'], hasAttachment: true, uid: 1 },
      { flags: ['Work'], hasAttachment: false, uid: 2 }
    ]
    expect(filterMessages(tagged, { ...NO_FILTER, attachments: true, tag: 'Work' }).map((m) => m.uid)).toEqual([1])
  })

  it('compare the flags without regard to case, as IMAP does', () => {
    expect(uids({ ...NO_FILTER, starred: true })).toContain(5)
  })

  it('keep the order of the list and give back the same objects', () => {
    const [first] = filterMessages(list, { ...NO_FILTER, unread: true })
    expect(first).toBe(list[0])
  })
})

describe('how many are said', () => {
  it('is one message, or a number of them, in German', () => {
    expect(countText(0)).toBe('Keine Nachrichten')
    expect(countText(1)).toBe('1 Nachricht')
    expect(countText(5)).toBe('5 Nachrichten')
  })

  it('says how many of how many when a filter keeps only some', () => {
    expect(countText(2, 5)).toBe('2 von 5 Nachrichten')
    expect(countText(5, 5)).toBe('5 Nachrichten')
  })
})
