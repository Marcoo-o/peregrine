import { describe, expect, it } from 'vitest'
import { DEFAULT_SORT, loadSort, saveSort, SORT_CHOICES, sortLabel, sortMessages } from './listSort'
import { migratedDatabase } from './testing/testDb'

const message = (uid: number, over: Partial<{ dateMs: number | null; subject: string; sender: string; size: number }> = {}) => ({
  uid,
  dateMs: 1000 + uid,
  subject: `s${uid}`,
  sender: `x${uid}@example.net`,
  size: uid * 10,
  ...over
})
const uids = (list: Array<{ uid: number }>) => list.map((m) => m.uid)

describe('ordering a list', () => {
  const list = [message(1, { dateMs: 300 }), message(2, { dateMs: null }), message(3, { dateMs: 100 }), message(4, { dateMs: 200 })]

  it('by date, the newest or the oldest first, and a message without a date is the oldest', () => {
    expect(uids(sortMessages(list, { field: 'date', direction: 'desc' }))).toEqual([1, 4, 3, 2])
    expect(uids(sortMessages(list, { field: 'date', direction: 'asc' }))).toEqual([2, 3, 4, 1])
  })

  it('by the name of the sender when there is one, else the address, without regard to case', () => {
    const senders = [
      message(1, { sender: 'Zoe <a@example.net>' }),
      message(2, { sender: '"anna" <z@example.net>' }),
      message(3, { sender: 'bob@example.net' }),
      message(4, { sender: 'Ben <b@example.net>' })
    ]
    expect(uids(sortMessages(senders, { field: 'from', direction: 'asc' }))).toEqual([2, 4, 3, 1])
    expect(uids(sortMessages(senders, { field: 'from', direction: 'desc' }))).toEqual([1, 3, 4, 2])
  })

  it('by subject without "Re:" and "Fwd:" in front, numbers as numbers', () => {
    const subjects = [message(1, { subject: 'Re: Zebra' }), message(2, { subject: 'apple' }), message(3, { subject: 'AW: Fwd: Mango 10' }), message(4, { subject: 'Mango 9' })]
    expect(uids(sortMessages(subjects, { field: 'subject', direction: 'asc' }))).toEqual([2, 4, 3, 1])
  })

  it('by size, the largest or the smallest first', () => {
    expect(uids(sortMessages(list, { field: 'size', direction: 'desc' }))).toEqual([4, 3, 2, 1])
    expect(uids(sortMessages(list, { field: 'size', direction: 'asc' }))).toEqual([1, 2, 3, 4])
  })

  it('keeps what is equal in the order of the newest first, and leaves the list it was given as it is', () => {
    const same = [message(1, { size: 5 }), message(2, { size: 5 }), message(3, { size: 5 })]
    const before = [...same]
    expect(uids(sortMessages(same, { field: 'size', direction: 'asc' }))).toEqual([3, 2, 1])
    expect(same).toEqual(before)
  })
})

describe('the words for an order', () => {
  it('are there for every choice, the default among them', () => {
    expect(SORT_CHOICES).toHaveLength(8)
    expect(sortLabel(DEFAULT_SORT)).toBe('Neueste zuerst')
    expect(sortLabel({ field: 'size', direction: 'asc' })).toBe('Kleinste zuerst')
  })
})

describe('the order that is kept', () => {
  it('is the newest first when nothing was set, and what was set after', async () => {
    const { db } = await migratedDatabase()
    expect(await loadSort(db)).toEqual(DEFAULT_SORT)
    await saveSort(db, { field: 'from', direction: 'asc' })
    expect(await loadSort(db)).toEqual({ field: 'from', direction: 'asc' })
  })

  it('takes the default for what is not an order, or not JSON', async () => {
    const { db } = await migratedDatabase()
    await db.run("INSERT INTO settings (name, value) VALUES ('sort', ?)", JSON.stringify({ field: 'colour', direction: 'asc' }))
    expect(await loadSort(db)).toEqual(DEFAULT_SORT)
    await db.run("UPDATE settings SET value = 'not json' WHERE name = 'sort'")
    expect(await loadSort(db)).toEqual(DEFAULT_SORT)
  })
})
