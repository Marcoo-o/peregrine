import { afterEach, describe, expect, it } from 'vitest'
import { DATE_FORMATS, DEFAULT_LOOK, DENSITIES, loadLook, look, saveLook } from './appearance'
import { appHarness } from './testing/appHarness'
import { migratedDatabase } from './testing/testDb'
import { DENSE_STYLES, DENSITY_FACTOR, densified } from './ui/scaleStyles'
import { shortDate } from './ui/shortDate'
import { ACCENTS, themeFor, type AccentName } from './ui/theme'

afterEach(() => look.set(DEFAULT_LOOK))

describe('the accents', () => {
  /** The relative luminance of a `#rrggbb` colour, as WCAG defines it. */
  const luminance = (hex: string): number => {
    const [r, g, b] = [1, 3, 5].map((start) => {
      const channel = parseInt(hex.slice(start, start + 2), 16) / 255
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const contrast = (a: string, b: string): number => {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (light + 0.05) / (dark + 0.05)
  }

  for (const accent of Object.keys(ACCENTS) as AccentName[]) {
    for (const scheme of ['light', 'dark'] as const) {
      it(`${accent} can be read as text on the pages of the ${scheme} scheme, and what is written on it can be read`, () => {
        const { colors } = themeFor(scheme, accent)
        expect(contrast(colors.accent, colors.background)).toBeGreaterThanOrEqual(4.5)
        expect(contrast(colors.accent, colors.surface)).toBeGreaterThanOrEqual(4.5)
        expect(contrast(colors.onAccent, colors.accent)).toBeGreaterThanOrEqual(4.5)
      })
    }
  }

  it('is blue unless one was chosen, and a theme is made once for a scheme and an accent', () => {
    expect(themeFor('light').colors.accent).toBe(ACCENTS.blue.light)
    expect(themeFor('dark', 'teal').colors.accent).toBe(ACCENTS.teal.dark)
    expect(themeFor('light', 'rose')).toBe(themeFor('light', 'rose'))
    expect(themeFor('light', 'rose')).not.toBe(themeFor('light', 'blue'))
    expect(themeFor('light', 'nonsense' as AccentName).colors.accent).toBe(ACCENTS.blue.light)
  })
})

describe('the date of a message in a list', () => {
  const now = new Date(2026, 9, 31, 12, 0)
  const today = new Date(2026, 9, 31, 8, 5).getTime()
  const thisYear = new Date(2026, 2, 4, 8, 5).getTime()
  const older = new Date(2024, 11, 24, 18, 30).getTime()

  it('is the time for today and the day for the rest of the year, and the whole date for what is older, by default', () => {
    expect(shortDate(today, now)).toBe('08:05')
    expect(shortDate(thisYear, now)).toMatch(/4\.\s*Mär/)
    expect(shortDate(older, now)).toBe('24.12.2024')
  })

  it('is a short date, always', () => {
    expect(shortDate(today, now, 'short')).toBe('31.10.26')
    expect(shortDate(older, now, 'short')).toBe('24.12.24')
  })

  it('is the whole date and the time when long', () => {
    expect(shortDate(older, now, 'long')).toMatch(/24\.12\.2024,? 18:30/)
  })

  it('is the ISO date and the time when iso, with the numbers filled', () => {
    expect(shortDate(thisYear, now, 'iso')).toBe('2026-03-04 08:05')
  })
})

describe('how close the lines of a list sit', () => {
  const styles = { item: { paddingVertical: 12, minHeight: 48 }, tagSheetRow: { paddingVertical: 10 }, other: { paddingVertical: 12 }, noPadding: { margin: 4 } }

  it('is the styles themselves at the normal density', () => {
    expect(densified(styles, 'cozy')).toBe(styles)
  })

  it('multiplies the vertical padding of the lines of a list, and nothing else, and leaves the minimum height of a touch target', () => {
    const tight = densified(styles, 'compact')
    expect(tight.item).toEqual({ paddingVertical: Math.round(12 * DENSITY_FACTOR.compact), minHeight: 48 })
    expect(tight.tagSheetRow.paddingVertical).toBe(Math.round(10 * DENSITY_FACTOR.compact))
    expect(tight.other).toBe(styles.other)
    expect(tight.noPadding).toBe(styles.noPadding)
    expect(densified(styles, 'comfortable').item.paddingVertical).toBe(Math.round(12 * DENSITY_FACTOR.comfortable))
  })

  it('has a list of the styles it is for, with the line of a list among them', () => {
    expect(DENSE_STYLES).toContain('item')
  })
})

describe('the look that is kept', () => {
  it('is the default when nothing was stored, and what was stored after, part by part', async () => {
    const { db } = await migratedDatabase()
    expect(await loadLook(db)).toEqual(DEFAULT_LOOK)
    await saveLook(db, { accent: 'purple' })
    await saveLook(db, { density: 'compact' })
    expect(await loadLook(db)).toEqual({ accent: 'purple', dateFormat: 'relative', density: 'compact' })
  })

  it('takes the default for each part that is not a choice, and for what is not JSON', async () => {
    const { db } = await migratedDatabase()
    await db.run("INSERT INTO settings (name, value) VALUES ('look', ?)", JSON.stringify({ accent: 'neon', dateFormat: 'iso', density: 'huge' }))
    expect(await loadLook(db)).toEqual({ accent: 'blue', dateFormat: 'iso', density: 'cozy' })
    await db.run("UPDATE settings SET value = 'not json' WHERE name = 'look'")
    expect(await loadLook(db)).toEqual(DEFAULT_LOOK)
  })

  it('has words for every choice, and tells those who watch it when it changes and not when it does not', () => {
    expect(DATE_FORMATS.map((choice) => choice.format)).toEqual(['relative', 'short', 'long', 'iso'])
    expect(DENSITIES.map((choice) => choice.density)).toEqual(['comfortable', 'cozy', 'compact'])
    let told = 0
    const stop = look.subscribe(() => told++)
    look.set({ ...DEFAULT_LOOK, accent: 'teal' })
    look.set({ ...DEFAULT_LOOK, accent: 'teal' })
    look.set(DEFAULT_LOOK)
    stop()
    expect(told).toBe(2)
  })

  it('is set from the settings at once, and comes back over a start', async () => {
    const t = await appHarness()
    await t.app.settings.setLook({ accent: 'rose', dateFormat: 'iso' })
    expect(look.current).toEqual({ accent: 'rose', dateFormat: 'iso', density: 'cozy' })
    look.set(DEFAULT_LOOK)
    await t.app.start()
    expect(look.current).toEqual({ accent: 'rose', dateFormat: 'iso', density: 'cozy' })
  })
})
