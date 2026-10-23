import { describe, expect, it } from 'vitest'
import type { Account } from '../accounts'
import { FakeTimers } from '../testing/fakeTimers'
import { RECONNECT_DELAYS_MS, Reconnector } from './Reconnector'

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

const account = (id: string): Account => ({ id }) as Account

function setup(options: { needing?: string[]; failing?: Set<string> } = {}) {
  const timers = new FakeTimers()
  const needing = options.needing ?? ['work']
  const failing = options.failing ?? new Set<string>()
  const calls: string[] = []
  const logs: string[] = []
  const reconnector = new Reconnector({
    needing: async () => needing.map(account),
    connect: async (a) => {
      calls.push(a.id)
      if (failing.has(a.id)) throw new Error(`${a.id} is not there`)
    },
    log: { warn: (m) => logs.push(m), error: (m) => logs.push(m) },
    timers
  })
  return { reconnector, timers, calls, logs, needing, failing }
}

describe('connecting again by itself', () => {
  it('tries after the first pause when something waits, and not before', async () => {
    const t = setup()
    t.reconnector.schedule()
    expect(t.timers.delays()).toEqual([RECONNECT_DELAYS_MS[0]])
    expect(t.calls).toEqual([])
    await t.timers.fire()
    expect(t.calls).toEqual(['work'])
  })

  it('arms one timer however often it is asked', () => {
    const t = setup()
    t.reconnector.schedule()
    t.reconnector.schedule()
    t.reconnector.schedule()
    expect(t.timers.pending.size).toBe(1)
  })

  it('does nothing and stays quiet when nothing waits', async () => {
    const t = setup({ needing: [] })
    t.reconnector.schedule()
    await t.timers.fire()
    expect(t.calls).toEqual([])
    expect(t.timers.pending.size).toBe(0)
  })

  it('tries every account that waits, and one that cannot be reached does not hold up the others', async () => {
    const t = setup({ needing: ['work', 'home'], failing: new Set(['work']) })
    t.reconnector.schedule()
    await t.timers.fire()
    expect(t.calls).toEqual(['work', 'home'])
  })

  it('waits longer after each failure, up to the last pause, and says why', async () => {
    const t = setup({ failing: new Set(['work']) })
    t.reconnector.schedule()
    const seen: number[] = []
    for (let i = 0; i < RECONNECT_DELAYS_MS.length + 2; i++) {
      seen.push(...t.timers.delays())
      await t.timers.fire()
    }
    expect(seen).toEqual([...RECONNECT_DELAYS_MS, RECONNECT_DELAYS_MS.at(-1), RECONNECT_DELAYS_MS.at(-1)])
    expect(t.logs[0]).toContain('work is not there')
  })

  it('stops trying once it has worked, and starts from the shortest pause again', async () => {
    const t = setup({ failing: new Set(['work']) })
    t.reconnector.schedule()
    await t.timers.fire()
    await t.timers.fire()
    expect(t.timers.delays()).toEqual([RECONNECT_DELAYS_MS[2]])

    t.failing.delete('work')
    await t.timers.fire()
    expect(t.timers.pending.size).toBe(0)

    t.failing.add('work')
    t.reconnector.schedule()
    expect(t.timers.delays()).toEqual([RECONNECT_DELAYS_MS[0]])
  })

  it('tries at once when the application comes to the front, and from the shortest pause again', async () => {
    const t = setup({ failing: new Set(['work']) })
    t.reconnector.schedule()
    await t.timers.fire()
    await t.timers.fire()
    expect(t.timers.delays()).toEqual([RECONNECT_DELAYS_MS[2]])

    t.failing.delete('work')
    await t.reconnector.wake()
    expect(t.calls).toHaveLength(3)
    expect(t.timers.pending.size).toBe(0)
  })

  it('keeps trying after the look for what waits has failed itself', async () => {
    const timers = new FakeTimers()
    let broken = true
    const calls: string[] = []
    const reconnector = new Reconnector({
      needing: async () => {
        if (broken) throw new Error('database is locked')
        return [account('work')]
      },
      connect: async (a) => void calls.push(a.id),
      log: { warn: () => undefined, error: () => undefined },
      timers
    })
    reconnector.schedule()
    await timers.fire()
    expect(timers.pending.size).toBe(1)
    broken = false
    await timers.fire()
    expect(calls).toEqual(['work'])
  })

  it('makes one more try, and not two at once, when asked while one is under way', async () => {
    const timers = new FakeTimers()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    let running = 0
    let most = 0
    let tries = 0
    const reconnector = new Reconnector({
      needing: async () => [account('work')],
      connect: async () => {
        tries++
        running++
        most = Math.max(most, running)
        if (tries === 1) await gate
        running--
      },
      log: { warn: () => undefined, error: () => undefined },
      timers
    })
    const first = reconnector.wake()
    await settle()
    const second = reconnector.wake()
    release()
    await Promise.all([first, second])
    expect(most).toBe(1)
    expect(tries).toBe(2)
  })

  it('does nothing any more once it is stopped, and has no timer left', async () => {
    const t = setup()
    t.reconnector.schedule()
    t.reconnector.stop()
    expect(t.timers.pending.size).toBe(0)
    t.reconnector.schedule()
    await t.reconnector.wake()
    expect(t.timers.pending.size).toBe(0)
    expect(t.calls).toEqual([])
  })
})
