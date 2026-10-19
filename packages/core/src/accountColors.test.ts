import { describe, expect, it } from 'vitest'
import { ACCOUNT_COLORS, nextAccountColor } from './accountColors'

describe('nextAccountColor', () => {
  // The actual point. With twelve accounts every one used to carry the same dot, because no
  // colour was set on creation at all. The first six have to differ.
  it('gives the first six accounts six different colours', () => {
    const colours = [0, 1, 2, 3, 4, 5].map(nextAccountColor)
    expect(new Set(colours).size).toBe(6)
  })

  it('starts over once the palette is used up', () => {
    expect(nextAccountColor(6)).toBe(nextAccountColor(0))
    expect(nextAccountColor(13)).toBe(nextAccountColor(1))
  })

  // With twelve accounts that means each colour exactly twice, and two identical ones sit six
  // rows apart rather than next to each other.
  it('spreads twelve accounts evenly over the palette', () => {
    const counted = new Map<string, number>()
    for (let i = 0; i < 12; i += 1) {
      const colour = nextAccountColor(i)
      counted.set(colour, (counted.get(colour) ?? 0) + 1)
    }
    expect([...counted.values()]).toEqual([2, 2, 2, 2, 2, 2])
  })

  it('always returns a colour from the palette', () => {
    for (const n of [0, 3, 17, 100]) {
      expect(ACCOUNT_COLORS).toContain(nextAccountColor(n))
    }
  })
})
