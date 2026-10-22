import { describe, expect, it } from 'vitest'
import { isSwipe, START_DISTANCE, swipeResult } from './swipe'

describe('whether a touch is a swipe of the row', () => {
  it('is one that has gone a little way sideways and not much up or down', () => {
    expect(isSwipe(START_DISTANCE + 1, 2)).toBe(true)
    expect(isSwipe(-(START_DISTANCE + 1), -3)).toBe(true)
  })

  it('is not one that has not gone far enough, which is a tap that moved a little', () => {
    expect(isSwipe(START_DISTANCE, 0)).toBe(false)
    expect(isSwipe(5, 0)).toBe(false)
  })

  it('is not one that goes mostly up or down, which is the list being scrolled', () => {
    expect(isSwipe(20, 40)).toBe(false)
    expect(isSwipe(30, 25)).toBe(false)
    expect(isSwipe(30, 18)).toBe(true)
  })
})

describe('what letting go of a swiped row does', () => {
  it('archives a row that was moved far enough to the right and deletes one moved far enough to the left', () => {
    expect(swipeResult(200, 400)).toBe('archive')
    expect(swipeResult(-200, 400)).toBe('delete')
  })

  it('does nothing for a row that was not moved far enough, whichever way', () => {
    expect(swipeResult(100, 400)).toBeNull()
    expect(swipeResult(-100, 400)).toBeNull()
    expect(swipeResult(0, 400)).toBeNull()
  })

  it('does nothing at exactly the distance, and counts from the width of the row', () => {
    expect(swipeResult(140, 400)).toBeNull()
    expect(swipeResult(141, 400)).toBe('archive')
    expect(swipeResult(141, 800)).toBeNull()
  })
})
