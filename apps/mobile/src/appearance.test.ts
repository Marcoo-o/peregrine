import { afterEach, describe, expect, it } from 'vitest'
import { appearance, loadAppearance, saveAppearance, schemeFor } from './appearance'
import { migratedDatabase } from './testing/testDb'

afterEach(() => appearance.set('system'))

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
