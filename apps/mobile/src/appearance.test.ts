import { afterEach, describe, expect, it } from 'vitest'
import { appearance, FONT_SCALES, fontFactor, fontScale, loadAppearance, loadFontScale, saveAppearance, saveFontScale, schemeFor } from './appearance'
import { migratedDatabase } from './testing/testDb'

afterEach(() => {
  appearance.set('system')
  fontScale.set('normal')
})

describe('light or dark', () => {
  it('follows the system where nothing was chosen, and is what was chosen otherwise', () => {
    expect(schemeFor('system', 'dark')).toBe('dark')
    expect(schemeFor('system', 'light')).toBe('light')
    expect(schemeFor('system', null)).toBe('light')
    expect(schemeFor('light', 'dark')).toBe('light')
    expect(schemeFor('dark', 'light')).toBe('dark')
  })

  it('is the system’s when nothing was stored, and what was stored after', async () => {
    const { db } = await migratedDatabase()
    expect(await loadAppearance(db)).toBe('system')
    await saveAppearance(db, 'dark')
    expect(await loadAppearance(db)).toBe('dark')
  })

  it('takes the system’s for what is stored that is not a mode, or not JSON', async () => {
    const { db } = await migratedDatabase()
    await db.run("INSERT INTO settings (name, value) VALUES ('appearance', ?)", JSON.stringify({ mode: 'purple' }))
    expect(await loadAppearance(db)).toBe('system')
    await db.run("UPDATE settings SET value = 'not json' WHERE name = 'appearance'")
    expect(await loadAppearance(db)).toBe('system')
  })

  it('tells those who watch it when it changes, and not when it does not', () => {
    let told = 0
    const stop = appearance.subscribe(() => told++)
    appearance.set('dark')
    appearance.set('dark')
    appearance.set('light')
    stop()
    appearance.set('system')
    expect(told).toBe(2)
  })
})

describe('the size of the text', () => {
  it('has a factor for each choice, normal being no change', () => {
    expect(FONT_SCALES.map((choice) => choice.scale)).toEqual(['small', 'normal', 'large', 'xlarge'])
    expect(fontFactor('normal')).toBe(1)
    expect(fontFactor('small')).toBeLessThan(1)
    expect(fontFactor('large')).toBeGreaterThan(1)
    expect(fontFactor('xlarge')).toBeGreaterThan(fontFactor('large'))
  })

  it('is normal when nothing was stored, what was stored after, and normal for what is not a choice or not JSON', async () => {
    const { db } = await migratedDatabase()
    expect(await loadFontScale(db)).toBe('normal')
    await saveFontScale(db, 'large')
    expect(await loadFontScale(db)).toBe('large')
    await db.run("UPDATE settings SET value = ? WHERE name = 'fontScale'", JSON.stringify({ scale: 'huge' }))
    expect(await loadFontScale(db)).toBe('normal')
    await db.run("UPDATE settings SET value = 'not json' WHERE name = 'fontScale'")
    expect(await loadFontScale(db)).toBe('normal')
  })

  it('tells those who watch it when it changes, and not when it does not', () => {
    let told = 0
    const stop = fontScale.subscribe(() => told++)
    fontScale.set('large')
    fontScale.set('large')
    fontScale.set('small')
    stop()
    expect(told).toBe(2)
  })
})
