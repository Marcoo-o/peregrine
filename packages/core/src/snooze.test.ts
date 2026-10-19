import { describe, expect, it } from 'vitest'
import {
  isPresetUseful,
  parseCustomSnooze,
  resolveSnoozePreset,
  snoozeChoices,
  SNOOZE_PRESETS
} from './snooze'

/** 7 August 2026 is a Friday. */
function at(day: number, hour: number, minute = 0): Date {
  return new Date(2026, 7, day, hour, minute)
}

describe('resolveSnoozePreset', () => {
  it('"later today" is three hours on, at a full hour', () => {
    expect(resolveSnoozePreset('laterToday', at(7, 9, 40))).toEqual(at(7, 12))
  })

  it('"this evening" is today at six', () => {
    expect(resolveSnoozePreset('thisEvening', at(7, 9))).toEqual(at(7, 18))
  })

  // A reminder in the past fires at once and reads as a broken feature.
  it('"this evening" after six means the next one', () => {
    expect(resolveSnoozePreset('thisEvening', at(7, 20))).toEqual(at(8, 18))
  })

  it('"tomorrow" is the next morning at eight', () => {
    expect(resolveSnoozePreset('tomorrow', at(7, 23, 30))).toEqual(at(8, 8))
  })

  it('"at the weekend" is the coming Saturday', () => {
    // Friday the 7th -> Saturday the 8th.
    expect(resolveSnoozePreset('weekend', at(7, 10))).toEqual(at(8, 8))
    // Monday the 10th -> Saturday the 15th.
    expect(resolveSnoozePreset('weekend', at(10, 10))).toEqual(at(15, 8))
  })

  it('"next week" is the coming Monday', () => {
    // Friday the 7th -> Monday the 10th.
    expect(resolveSnoozePreset('nextWeek', at(7, 10))).toEqual(at(10, 8))
  })

  // Asked for on the day itself, a weekday preset means the next one, not today.
  it('a weekday asked for on that weekday means the next one', () => {
    // Saturday the 8th -> Saturday the 15th.
    expect(resolveSnoozePreset('weekend', at(8, 10))).toEqual(at(15, 8))
    // Monday the 10th -> Monday the 17th.
    expect(resolveSnoozePreset('nextWeek', at(10, 10))).toEqual(at(17, 8))
  })

  it('no preset ever lands in the past', () => {
    for (const hour of [0, 7, 12, 18, 23]) {
      for (const day of [7, 8, 9, 10]) {
        const now = at(day, hour, 30)
        for (const preset of SNOOZE_PRESETS) {
          expect(resolveSnoozePreset(preset, now).getTime()).toBeGreaterThan(now.getTime())
        }
      }
    }
  })
})

describe('isPresetUseful', () => {
  it('hides "this evening" once it is evening', () => {
    expect(isPresetUseful('thisEvening', at(7, 17))).toBe(true)
    expect(isPresetUseful('thisEvening', at(7, 18))).toBe(false)
  })

  it('hides "later today" when three hours cross midnight', () => {
    expect(isPresetUseful('laterToday', at(7, 18))).toBe(true)
    expect(isPresetUseful('laterToday', at(7, 22))).toBe(false)
  })

  it('hides the weekend on a weekend', () => {
    expect(isPresetUseful('weekend', at(7, 10))).toBe(true)
    expect(isPresetUseful('weekend', at(8, 10))).toBe(false)
    expect(isPresetUseful('weekend', at(9, 10))).toBe(false)
  })
})

describe('snoozeChoices', () => {
  it('runs forwards in time', () => {
    const times = snoozeChoices(at(7, 10)).map((c) => c.at.getTime())
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })

  // On a Friday "tomorrow morning" and "at the weekend" are the same Saturday at eight.
  it('offers the same moment only once', () => {
    const choices = snoozeChoices(at(7, 10))
    const times = choices.map((c) => c.at.getTime())
    expect(new Set(times).size).toBe(times.length)
    expect(choices.map((c) => c.preset)).not.toContain('weekend')
    expect(choices.map((c) => c.preset)).toContain('tomorrow')
  })

  it('keeps both when they differ', () => {
    // Monday: tomorrow is Tuesday, the weekend is Saturday.
    const presets = snoozeChoices(at(10, 10)).map((c) => c.preset)
    expect(presets).toContain('tomorrow')
    expect(presets).toContain('weekend')
  })

  it('never offers a moment that has passed', () => {
    for (const hour of [0, 9, 17, 19, 23]) {
      const now = at(7, hour, 15)
      for (const choice of snoozeChoices(now)) {
        expect(choice.at.getTime()).toBeGreaterThan(now.getTime())
      }
    }
  })
})

describe('parseCustomSnooze', () => {
  it('reads a datetime-local value', () => {
    expect(parseCustomSnooze('2026-08-09T14:30', at(7, 10))).toBe(at(9, 14, 30).getTime())
  })

  it('rejects a time that has passed', () => {
    expect(parseCustomSnooze('2026-08-06T14:30', at(7, 10))).toBeNull()
  })

  it('rejects what is not a time', () => {
    expect(parseCustomSnooze('', at(7, 10))).toBeNull()
    expect(parseCustomSnooze('irgendwann', at(7, 10))).toBeNull()
  })
})
