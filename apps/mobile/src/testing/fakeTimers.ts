import type { ReconnectTimers } from '../app/Reconnector'

/** Timers a test holds in its hand: nothing fires until it says so. */
export class FakeTimers implements ReconnectTimers {
  private next = 1
  readonly pending = new Map<number, { run: () => void; delayMs: number }>()
  set = (run: () => void, delayMs: number): number => {
    const id = this.next++
    this.pending.set(id, { run, delayMs })
    return id
  }
  clear = (handle: unknown): void => {
    this.pending.delete(handle as number)
  }
  delays(): number[] {
    return [...this.pending.values()].map((timer) => timer.delayMs)
  }
  /** Fires what is set, and lets what that started finish. */
  async fire(): Promise<void> {
    for (const [id, timer] of [...this.pending]) {
      this.pending.delete(id)
      timer.run()
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}
