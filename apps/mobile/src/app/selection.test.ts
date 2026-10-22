import { describe, expect, it } from 'vitest'
import { groupByFolder, keyOf, pickedIn, toggled, type Picked } from './selection'

const at = (folderId: string, uid: number, accountId = 'a'): Picked => ({ accountId, folderId, uid })

describe('a message that is chosen in a list', () => {
  it('is told apart by the folder it is in and its UID, which are what the queue knows it by', () => {
    expect(keyOf(at('f1', 3))).toBe('f1:3')
    expect(keyOf(at('f1', 3))).not.toBe(keyOf(at('f2', 3)))
    expect(keyOf(at('f1', 3))).not.toBe(keyOf(at('f1', 4)))
  })

  it('is chosen by being chosen once, and chosen no more by being chosen again', () => {
    const once = toggled(new Set<string>(), 'f1:3')
    expect([...once]).toEqual(['f1:3'])
    expect([...toggled(once, 'f1:3')]).toEqual([])
  })

  it('leaves the set it was given as it was', () => {
    const before = new Set(['f1:3'])
    toggled(before, 'f1:4')
    expect([...before]).toEqual(['f1:3'])
  })
})

describe('the messages that are chosen, of those that are shown', () => {
  const shown = [at('f1', 1), at('f1', 2), at('f2', 1)]

  it('are those of the list that were chosen, in the order of the list', () => {
    expect(pickedIn(shown, new Set(['f2:1', 'f1:2']))).toEqual([at('f1', 2), at('f2', 1)])
  })

  it('do not include what was chosen and is not in the list any more', () => {
    expect(pickedIn(shown, new Set(['f1:2', 'f9:9']))).toEqual([at('f1', 2)])
  })
})

describe('what is chosen, by the folder it is in', () => {
  it('is one group for each folder, with the UIDs in it, in the order they were chosen', () => {
    const groups = groupByFolder([at('f1', 2), at('f2', 7, 'b'), at('f1', 1)])
    expect(groups).toEqual([
      { folderId: 'f1', accountId: 'a', uids: [2, 1] },
      { folderId: 'f2', accountId: 'b', uids: [7] }
    ])
  })

  it('is nothing when nothing is chosen', () => {
    expect(groupByFolder([])).toEqual([])
  })
})
