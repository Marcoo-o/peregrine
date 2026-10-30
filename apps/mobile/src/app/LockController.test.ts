import { describe, expect, it } from 'vitest'
import { loadLock, saveLock } from '../lock'
import { appHarness } from '../testing/appHarness'
import { LockController } from './LockController'

/** An application whose lock is on, with the minute that is the default, and a controller that reads a clock of the test's own. */
async function locked() {
  const t = await appHarness()
  await t.givenAccount('work', {})
  await saveLock(t.db, { enabled: true, afterSeconds: 60 })
  let now = 1_000_000
  const lock = new LockController(t.app.services, t.store, () => now)
  const later = (ms: number) => (now += ms)
  return { ...t, lock, later }
}

describe('the lock at the start', () => {
  it('locks the application before anything is shown, and keeps its screens out of screenshots', async () => {
    const t = await locked()
    await t.lock.start()
    expect(t.store.state.locked).toBe(true)
    expect(t.deviceLock.secure).toBe(true)
  })

  it('does nothing when it is off, and lets the screens be in screenshots', async () => {
    const t = await appHarness()
    await t.app.lock.start()
    expect(t.store.state.locked).toBe(false)
    expect(t.deviceLock.secure).toBe(false)
  })

  it('is part of starting the application', async () => {
    const t = await appHarness()
    await t.givenAccount('work', {})
    await saveLock(t.db, { enabled: true })
    await t.app.start()
    expect(t.store.state.locked).toBe(true)
  })
})

describe('opening the application', () => {
  it('is done with the screen lock of the device, and the application is open when it is given', async () => {
    const t = await locked()
    await t.lock.start()
    expect(await t.lock.unlock()).toBe(true)
    expect(t.store.state.locked).toBe(false)
    expect(t.deviceLock.asked).toBe(1)
  })

  it('stays locked when the user cancels, and can be asked again', async () => {
    const t = await locked()
    await t.lock.start()
    t.deviceLock.answer = false
    expect(await t.lock.unlock()).toBe(false)
    expect(t.store.state.locked).toBe(true)
    t.deviceLock.answer = true
    expect(await t.lock.unlock()).toBe(true)
  })

  it('stays locked, and says so in the log, when the system cannot be asked', async () => {
    const t = await locked()
    await t.lock.start()
    t.deviceLock.authenticate = async () => {
      throw new Error('no activity')
    }
    expect(await t.lock.unlock()).toBe(false)
    expect(t.store.state.locked).toBe(true)
    expect(t.logs.some((line) => line.includes('no activity'))).toBe(true)
  })

  it('asks once at a time', async () => {
    const t = await locked()
    await t.lock.start()
    let release: (given: boolean) => void = () => undefined
    t.deviceLock.authenticate = () => new Promise((resolve) => (release = resolve))
    const first = t.lock.unlock()
    expect(await t.lock.unlock()).toBe(false)
    release(true)
    expect(await first).toBe(true)
  })
})

describe('coming back after being away', () => {
  it('does not lock when it was away for less than the time, and does when for that long or longer', async () => {
    const t = await locked()
    await t.lock.start()
    await t.lock.unlock()
    t.lock.wentAway()
    t.later(30_000)
    await t.lock.cameBack()
    expect(t.store.state.locked).toBe(false)

    t.lock.wentAway()
    t.later(61_000)
    t.deviceLock.answer = false
    await t.lock.cameBack()
    expect(t.store.state.locked).toBe(true)
  })

  it('asks for the screen lock at once when it locks', async () => {
    const t = await locked()
    await t.lock.start()
    await t.lock.unlock()
    const before = t.deviceLock.asked
    t.lock.wentAway()
    t.later(120_000)
    await t.lock.cameBack()
    expect(t.deviceLock.asked).toBe(before + 1)
    expect(t.store.state.locked).toBe(false)
  })

  it('is not away while the system asks for the lock, which takes the application out of sight', async () => {
    const t = await locked()
    await saveLock(t.db, { afterSeconds: 0 })
    await t.lock.start()
    let release: (given: boolean) => void = () => undefined
    t.deviceLock.authenticate = () => new Promise((resolve) => (release = resolve))
    const opening = t.lock.unlock()
    t.lock.wentAway()
    await t.lock.cameBack()
    release(true)
    await opening
    expect(t.store.state.locked).toBe(false)
    // nothing was noted as being away, so coming back again does not lock
    await t.lock.cameBack()
    expect(t.store.state.locked).toBe(false)
  })

  it('is nothing when the lock is off, however long it was away', async () => {
    const t = await appHarness()
    t.app.lock.wentAway()
    await t.app.lock.cameBack()
    expect(t.store.state.locked).toBe(false)
  })
})

describe('switching the lock on and off', () => {
  it('on asks for the screen lock once, to prove that it works, and then keeps it on and the screens out of screenshots', async () => {
    const t = await appHarness()
    expect(await t.app.lock.setEnabled(true)).toBeUndefined()
    expect(t.deviceLock.asked).toBe(1)
    expect((await loadLock(t.db)).enabled).toBe(true)
    expect(t.deviceLock.secure).toBe(true)
  })

  it('on is refused, with the reason, for a phone without a screen lock', async () => {
    const t = await appHarness()
    t.deviceLock.hasLock = false
    expect(await t.app.lock.setEnabled(true)).toContain('keine Bildschirmsperre')
    expect((await loadLock(t.db)).enabled).toBe(false)
  })

  it('stays as it was when the lock is not given', async () => {
    const t = await appHarness()
    t.deviceLock.answer = false
    expect(await t.app.lock.setEnabled(true)).toContain('bleibt aus')
    expect((await loadLock(t.db)).enabled).toBe(false)
    await saveLock(t.db, { enabled: true })
    expect(await t.app.lock.setEnabled(false)).toContain('bleibt an')
    expect((await loadLock(t.db)).enabled).toBe(true)
  })

  it('off asks for it too, so that whoever has the unlocked phone cannot take it away, and lets the screens be in screenshots again', async () => {
    const t = await appHarness()
    await saveLock(t.db, { enabled: true })
    expect(await t.app.lock.setEnabled(false)).toBeUndefined()
    expect(t.deviceLock.asked).toBe(1)
    expect((await loadLock(t.db)).enabled).toBe(false)
    expect(t.deviceLock.secure).toBe(false)
  })

  it('has the time kept', async () => {
    const t = await appHarness()
    await t.app.lock.setDelay(900)
    expect((await loadLock(t.db)).afterSeconds).toBe(900)
  })
})

describe('the settings screen', () => {
  it('has what is set about the lock and whether the phone has one', async () => {
    const t = await appHarness()
    await t.app.settings.show()
    expect(t.store.screen).toMatchObject({ name: 'settings', lock: { enabled: false }, lockAvailable: true })
    t.deviceLock.hasLock = false
    await t.app.settings.show()
    expect(t.store.screen).toMatchObject({ lockAvailable: false })
  })

  it('switches it on and off, and says why it did not', async () => {
    const t = await appHarness()
    await t.app.settings.setLock(true)
    expect(t.store.screen).toMatchObject({ lock: { enabled: true } })
    t.deviceLock.answer = false
    await t.app.settings.setLock(false)
    expect(t.store.screen).toMatchObject({ lock: { enabled: true }, notice: expect.stringContaining('bleibt an') })
  })

  it('has the time chosen', async () => {
    const t = await appHarness()
    await t.app.settings.setLockDelay(300)
    expect(t.store.screen).toMatchObject({ lock: { afterSeconds: 300 } })
  })
})
