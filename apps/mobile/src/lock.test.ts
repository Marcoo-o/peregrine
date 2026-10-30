import { describe, expect, it } from 'vitest'
import { DEFAULT_LOCK, delayLabel, loadLock, LOCK_DELAYS, mustLock, saveLock } from './lock'
import { migratedDatabase } from './testing/testDb'

describe('when the application is locked', () => {
  const on = { enabled: true, afterSeconds: 60 }

  it('is never when the lock is off, and never when it was not away', () => {
    expect(mustLock({ enabled: false, afterSeconds: 0 }, 0, 1_000_000)).toBe(false)
    expect(mustLock(on, null, 1_000_000)).toBe(false)
  })

  it('is when it was away for the time that was set or longer, and not before', () => {
    expect(mustLock(on, 1_000_000, 1_000_000 + 59_999)).toBe(false)
    expect(mustLock(on, 1_000_000, 1_000_000 + 60_000)).toBe(true)
    expect(mustLock(on, 1_000_000, 1_000_000 + 600_000)).toBe(true)
  })

  it('is every time it comes back when the time is none', () => {
    expect(mustLock({ enabled: true, afterSeconds: 0 }, 5, 5)).toBe(true)
  })

  it('counts a clock that went back as no time away', () => {
    expect(mustLock(on, 2_000_000, 1_000_000)).toBe(false)
    expect(mustLock({ enabled: true, afterSeconds: 0 }, 2_000_000, 1_000_000)).toBe(true)
  })
})

describe('the settings of the lock', () => {
  it('are off with a minute when nothing was set, and what was set after', async () => {
    const { db } = await migratedDatabase()
    expect(await loadLock(db)).toEqual(DEFAULT_LOCK)
    expect(DEFAULT_LOCK.enabled).toBe(false)
    await saveLock(db, { enabled: true })
    await saveLock(db, { afterSeconds: 300 })
    expect(await loadLock(db)).toEqual({ enabled: true, afterSeconds: 300 })
  })

  it('take only the times that are offered, and off for what is not a switch', async () => {
    const { db } = await migratedDatabase()
    await db.run("INSERT INTO settings (name, value) VALUES ('lock', ?)", JSON.stringify({ enabled: 'yes', afterSeconds: 7 }))
    expect(await loadLock(db)).toEqual(DEFAULT_LOCK)
    await db.run("UPDATE settings SET value = 'not json' WHERE name = 'lock'")
    expect(await loadLock(db)).toEqual(DEFAULT_LOCK)
  })

  it('have words for every time', () => {
    expect(LOCK_DELAYS.map(delayLabel)).toEqual(['Sofort', '1 Minuten', '5 Minuten', '15 Minuten'])
  })
})
