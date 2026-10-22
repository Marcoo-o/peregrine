import { describe, expect, it } from 'vitest'
import { backAtText, momentText, snoozeOptions } from './snoozeText'

// A Thursday, in the clock of whoever runs the test, which is the clock the presets are read in.
const at = (hour: number) => new Date(2026, 9, 22, hour, 0, 0, 0)

describe('what a message can be put aside until', () => {
  it('is the presets of the desktop in the order of their time, with the names the desktop gives them', () => {
    const options = snoozeOptions(at(10))
    expect(options.map((option) => option.label)).toEqual(['Heute später', 'Heute Abend', 'Morgen früh', 'Am Wochenende', 'Nächste Woche'])
    expect(options.map((option) => option.until)).toEqual([...options.map((option) => option.until)].sort((a, b) => a - b))
  })

  it('has every moment ahead of now, as the time it says it is', () => {
    const now = at(10)
    for (const option of snoozeOptions(now)) {
      expect(option.until).toBeGreaterThan(now.getTime())
      expect(option.when).toBe(momentText(option.until))
    }
  })

  it('leaves out this evening once it is evening, and later today once that would be tomorrow', () => {
    expect(snoozeOptions(at(20)).map((option) => option.label)).not.toContain('Heute Abend')
    expect(snoozeOptions(at(22)).map((option) => option.label)).not.toContain('Heute später')
  })

  it('does not offer the weekend on a Saturday or a Sunday', () => {
    const saturday = new Date(2026, 9, 24, 10, 0)
    expect(snoozeOptions(saturday).map((option) => option.label)).not.toContain('Am Wochenende')
  })
})

describe('when a message comes back, as a line says it', () => {
  it('names the day of the week, the day and the time', () => {
    const text = momentText(new Date(2026, 9, 23, 8, 0).getTime())
    expect(text).toContain('Fr')
    expect(text).toContain('23')
    expect(text).toContain('08:00')
  })

  it('is the moment after "Zurück am", as the desktop says it', () => {
    expect(backAtText(new Date(2026, 9, 23, 8, 0).getTime())).toBe(`Zurück am ${momentText(new Date(2026, 9, 23, 8, 0).getTime())}`)
  })
})
