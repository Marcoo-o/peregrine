import { describe, expect, it } from 'vitest'
import type { ImapSession } from './imapSession'
import { QueueRunner, type QueueEnvironment, type QueueLocalMail, type QueueStore } from './offlineQueue'
import type { PendingAction, PendingPayload } from './pendingActions'
import type { ComposeInput } from './types'

/** A clock and timers the test holds in its hand: nothing fires until it says so. */
class FakeTimers {
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
  /** Fires every timer that was set with this delay. */
  fire(delayMs: number): void {
    for (const [id, timer] of [...this.pending]) {
      if (timer.delayMs === delayMs) {
        this.pending.delete(id)
        timer.run()
      }
    }
  }
  delays(): number[] {
    return [...this.pending.values()].map((timer) => timer.delayMs)
  }
}

let nextId = 1
function action(kind: PendingAction['kind'], payload: PendingPayload, over: Partial<PendingAction> = {}): PendingAction {
  return {
    id: nextId++,
    accountId: 'a',
    kind,
    payload,
    createdAt: 0,
    attempts: 0,
    lastError: null,
    dueAt: null,
    ...over
  }
}

const flags = (over: Partial<{ folderId: string; uids: number[]; add: string[]; remove: string[] }> = {}): PendingAction =>
  action('flags', { folderId: 'inbox', uids: [5, 6], add: ['\\Seen'], remove: [], ...over })
const move = (over: Partial<{ sourceFolderId: string; targetFolderId: string; uids: number[] }> = {}): PendingAction =>
  action('move', { sourceFolderId: 'inbox', targetFolderId: 'archive', uids: [7], ...over })
const del = (over: Partial<{ folderId: string; uids: number[] }> = {}): PendingAction =>
  action('delete', { folderId: 'trash', uids: [9], ...over })
const send = (over: Partial<ComposeInput> = {}, a: Partial<PendingAction> = {}): PendingAction =>
  action('send', { input: { subject: 'Hi', ...over } as ComposeInput }, a)

function setup(actions: PendingAction[], options: { timeoutMs?: number; now?: number } = {}) {
  const calls: string[] = []
  const logs: string[] = []
  const timers = new FakeTimers()
  let queued = [...actions]
  let due: number | null = null
  const folders: Record<string, string> = { inbox: 'INBOX', archive: 'Archive', trash: 'Trash' }

  const store: QueueStore = {
    list: async (accountId) => queued.filter((a) => a.accountId === accountId),
    remove: async (id) => {
      calls.push(`remove ${id}`)
      queued = queued.filter((a) => a.id !== id)
    },
    recordFailure: async (id, message) => {
      calls.push(`fail ${id}: ${message}`)
    },
    nextDueAt: async () => due
  }
  const local: QueueLocalMail = {
    folderPath: async (id) => folders[id] ?? null,
    forgetMoved: async (folder, uids) => {
      calls.push(`forget ${folder} ${uids.join(',')}`)
    },
    clearMoveMark: async (folder, uids) => {
      calls.push(`unmark ${folder} ${uids.join(',')}`)
    }
  }
  const env: QueueEnvironment = {
    changed: async () => {
      calls.push('changed')
    },
    log: { warn: (m) => logs.push(`warn: ${m}`), error: (m) => logs.push(`error: ${m}`) },
    now: () => options.now ?? 0,
    actionTimeoutMs: options.timeoutMs ?? 5000,
    timers
  }
  const imap = {
    addFlags: async (path: string, uid: number, f: string[]): Promise<void> => {
      calls.push(`add ${path} ${uid} ${f.join(',')}`)
    },
    removeFlags: async (path: string, uid: number, f: string[]): Promise<void> => {
      calls.push(`rm ${path} ${uid} ${f.join(',')}`)
    },
    moveMessages: async (from: string, to: string, uids: number[]) => {
      calls.push(`move ${from}>${to} ${uids.join(',')}`)
      return null
    },
    deleteMessages: async (path: string, uids: number[]): Promise<void> => {
      calls.push(`delete ${path} ${uids.join(',')}`)
    }
  }
  const runner = new QueueRunner(store, local, env)
  return {
    runner,
    calls,
    logs,
    timers,
    folders,
    imap: imap as unknown as ImapSession,
    rawImap: imap,
    setDue: (value: number | null) => {
      due = value
    }
  }
}

describe('flags', () => {
  it('adds and removes them for every message, in order, and takes the action off the queue', async () => {
    const waiting = flags({ uids: [5, 6], add: ['\\Seen', '$x'], remove: ['\\Flagged'] })
    const t = setup([waiting])
    await t.runner.flush('a', t.imap)
    expect(t.calls).toEqual([
      'add INBOX 5 \\Seen,$x',
      'rm INBOX 5 \\Flagged',
      'add INBOX 6 \\Seen,$x',
      'rm INBOX 6 \\Flagged',
      `remove ${waiting.id}`,
      'changed'
    ])
  })

  it('does not call the server for a list that is empty', async () => {
    const t = setup([flags({ add: ['\\Seen'], remove: [] })])
    await t.runner.flush('a', t.imap)
    expect(t.calls.filter((c) => c.startsWith('rm '))).toEqual([])
  })

  it('drops an action whose folder is gone, without a word to the server', async () => {
    const t = setup([flags({ folderId: 'deleted' })])
    await t.runner.flush('a', t.imap)
    expect(t.calls.filter((c) => c.startsWith('add ') || c.startsWith('rm '))).toEqual([])
    expect(t.calls.some((c) => c.startsWith('remove '))).toBe(true)
    expect(t.logs[0]).toMatch(/had nothing left to act on and was dropped/)
  })

  it('drops an action that names no messages', async () => {
    const t = setup([flags({ uids: [] })])
    await t.runner.flush('a', t.imap)
    expect(t.calls.some((c) => c.startsWith('remove '))).toBe(true)
    expect(t.logs[0]).toMatch(/dropped/)
  })
})

describe('move', () => {
  it('tells the server first and forgets the local rows only after', async () => {
    const t = setup([move({ uids: [7, 8] })])
    await t.runner.flush('a', t.imap)
    const moved = t.calls.indexOf('move INBOX>Archive 7,8')
    const forgot = t.calls.indexOf('forget inbox 7,8')
    expect(moved).toBeGreaterThanOrEqual(0)
    expect(forgot).toBeGreaterThan(moved)
    expect(t.calls.some((c) => c.startsWith('remove '))).toBe(true)
  })

  it('keeps the local rows when the server refuses, and stops', async () => {
    const t = setup([move(), flags()])
    t.rawImap.moveMessages = async () => {
      throw new Error('NO [CANNOT] move failed')
    }
    await t.runner.flush('a', t.imap)
    expect(t.calls.some((c) => c.startsWith('forget'))).toBe(false)
    expect(t.calls.some((c) => c.includes('fail') && c.includes('move failed'))).toBe(true)
    expect(t.calls.some((c) => c.startsWith('add '))).toBe(false)
  })

  it('takes the mark off the messages when a folder is gone, because no move is coming', async () => {
    for (const gone of [{ targetFolderId: 'deleted' }, { sourceFolderId: 'deleted' }]) {
      const t = setup([move(gone)])
      await t.runner.flush('a', t.imap)
      expect(t.calls.some((c) => c.startsWith('move '))).toBe(false)
      expect(t.calls.some((c) => c.startsWith('unmark '))).toBe(true)
      expect(t.calls.some((c) => c.startsWith('remove '))).toBe(true)
    }
  })

  it('takes the mark off a move that names no messages', async () => {
    const t = setup([move({ uids: [] })])
    await t.runner.flush('a', t.imap)
    expect(t.calls.some((c) => c.startsWith('unmark '))).toBe(true)
  })
})

describe('delete', () => {
  it('deletes on the server and takes the action off the queue', async () => {
    const t = setup([del({ uids: [9, 10] })])
    await t.runner.flush('a', t.imap)
    expect(t.calls).toContain('delete Trash 9,10')
    expect(t.calls.some((c) => c.startsWith('remove '))).toBe(true)
  })

  it('drops a deletion whose folder is gone', async () => {
    const t = setup([del({ folderId: 'deleted' })])
    await t.runner.flush('a', t.imap)
    expect(t.calls.some((c) => c.startsWith('delete '))).toBe(false)
    expect(t.logs[0]).toMatch(/dropped/)
  })
})

describe('send', () => {
  it('sends with the send handler, marked to go out now, and removes it only after', async () => {
    const t = setup([send({ subject: 'Hello' })])
    const sent: ComposeInput[] = []
    t.runner.setSendHandler(async (input) => {
      t.calls.push('sending')
      sent.push(input)
    })
    await t.runner.flush('a', t.imap)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ subject: 'Hello', sendNow: true })
    expect(t.calls.indexOf('sending')).toBeLessThan(t.calls.findIndex((c) => c.startsWith('remove ')))
  })

  // `false` means "nothing left to act on" and the row is dropped, so a message would have
  // disappeared unsent. A missing handler means it cannot run yet.
  it('does not drop a message when there is nothing to send it with yet', async () => {
    const t = setup([send()])
    await t.runner.flush('a', t.imap)
    expect(t.calls.some((c) => c.startsWith('remove '))).toBe(false)
    expect(t.calls.some((c) => c.includes('fail') && c.includes('no send handler'))).toBe(true)
  })

  it('keeps a message that could not be sent, and what it failed with', async () => {
    const t = setup([send()])
    t.runner.setSendHandler(async () => {
      throw new Error('connection refused')
    })
    await t.runner.flush('a', t.imap)
    expect(t.calls.some((c) => c.startsWith('remove '))).toBe(false)
    expect(t.calls.some((c) => c.endsWith(': connection refused'))).toBe(true)
  })

  it('goes out once a handler has been registered, on the next run', async () => {
    const t = setup([send()])
    await t.runner.flush('a', t.imap)
    const sent: number[] = []
    t.runner.setSendHandler(async () => {
      sent.push(1)
    })
    await t.runner.flush('a', t.imap)
    expect(sent).toEqual([1])
    expect(t.calls.some((c) => c.startsWith('remove '))).toBe(true)
  })
})

describe('order and failure', () => {
  it('runs the actions of an account one after another, in the order they were given', async () => {
    const t = setup([flags({ uids: [1] }), move({ uids: [2] }), del({ uids: [3] })])
    await t.runner.flush('a', t.imap)
    const steps = t.calls.filter((c) => /^(add|move|delete) /.test(c))
    expect(steps).toEqual(['add INBOX 1 \\Seen', 'move INBOX>Archive 2', 'delete Trash 3'])
  })

  it('stops at the first failure, keeps it with its reason, and does not touch what comes after', async () => {
    const t = setup([flags({ uids: [1] }), move({ uids: [2] }), del({ uids: [3] })])
    t.rawImap.moveMessages = async () => {
      throw new Error('server said no')
    }
    await t.runner.flush('a', t.imap)
    expect(t.calls.some((c) => c.startsWith('add '))).toBe(true)
    expect(t.calls.some((c) => c.includes('fail') && c.endsWith('server said no'))).toBe(true)
    expect(t.calls.some((c) => c.startsWith('delete '))).toBe(false)
    expect(t.logs.some((l) => l.startsWith('error: replaying pending action'))).toBe(true)
  })

  it('does not replay an account that is already being replayed', async () => {
    let release: () => void = () => undefined
    const t = setup([flags({ uids: [1] })])
    t.rawImap.addFlags = (path: string, uid: number, f: string[]) =>
      new Promise<void>((resolve) => {
        t.calls.push(`add ${path} ${uid} ${f.join(',')}`)
        release = resolve
      })
    const first = t.runner.flush('a', t.imap)
    await new Promise((resolve) => setTimeout(resolve, 5))
    await t.runner.flush('a', t.imap)
    expect(t.calls.filter((c) => c.startsWith('add '))).toHaveLength(1)
    release()
    await first
    // and the account can be replayed again once it is done
    expect(t.calls.filter((c) => c === 'changed')).toHaveLength(1)
  })

  it('replays two accounts independently', async () => {
    const other = { ...flags({ uids: [2] }), accountId: 'b' }
    const t = setup([flags({ uids: [1] }), other])
    await Promise.all([t.runner.flush('a', t.imap), t.runner.flush('b', t.imap)])
    expect(t.calls.filter((c) => c.startsWith('add '))).toHaveLength(2)
  })

  it('says that something changed after a run, whether it went well or not', async () => {
    const ok = setup([flags()])
    await ok.runner.flush('a', ok.imap)
    expect(ok.calls.at(-1)).toBe('changed')

    const bad = setup([move()])
    bad.rawImap.moveMessages = async () => {
      throw new Error('no')
    }
    await bad.runner.flush('a', bad.imap)
    expect(bad.calls.at(-1)).toBe('changed')
  })

  it('has nothing to do for an account with no actions, and still says it ran', async () => {
    const t = setup([])
    await t.runner.flush('a', t.imap)
    expect(t.calls).toEqual(['changed'])
  })
})

describe('the deadline', () => {
  // Measured with a send to an unreachable server: the promise never settled, and everything
  // behind it waited with it.
  it('counts an action that never finishes as a failed attempt, and does not wait for it', async () => {
    const t = setup([flags({ uids: [1] }), del()], { timeoutMs: 5000 })
    t.rawImap.addFlags = () => new Promise<void>(() => undefined)
    const run = t.runner.flush('a', t.imap)
    await new Promise((resolve) => setTimeout(resolve, 5))
    t.timers.fire(5000)
    await run
    expect(t.calls.some((c) => c.includes('fail') && c.includes('timed out after 5s'))).toBe(true)
    expect(t.calls.some((c) => c.startsWith('delete '))).toBe(false)
    expect(t.calls.at(-1)).toBe('changed')
  })

  it('takes the deadline off again when the action finishes in time', async () => {
    const t = setup([flags()])
    await t.runner.flush('a', t.imap)
    expect(t.timers.pending.size).toBe(0)
  })
})

describe('the timer for scheduled messages', () => {
  const HOUR = 3600_000
  const flushes = (): { count: number; run: () => void } => {
    const f = { count: 0, run: () => void f.count++ }
    return f
  }

  it('arms one timer for the next due message, with a second of slack', async () => {
    const t = setup([], { now: 1_000_000 })
    t.setDue(1_000_000 + 5000)
    await t.runner.rescheduleDue(flushes().run)
    expect(t.timers.delays()).toEqual([6000])
  })

  it('does not arm anything when nothing waits for a moment', async () => {
    const t = setup([])
    t.setDue(null)
    await t.runner.rescheduleDue(flushes().run)
    expect(t.timers.pending.size).toBe(0)
  })

  it('fires at once for something that is already due, with the second of slack', async () => {
    const t = setup([], { now: 5000 })
    t.setDue(1000)
    await t.runner.rescheduleDue(flushes().run)
    expect(t.timers.delays()).toEqual([1000])
  })

  it('caps the delay at a day, because the platform timer fires at once past about 24 days', async () => {
    const t = setup([], { now: 0 })
    t.setDue(90 * 24 * HOUR)
    await t.runner.rescheduleDue(flushes().run)
    expect(t.timers.delays()).toEqual([24 * HOUR])
  })

  it('runs the queue when the timer fires, and arms the next one', async () => {
    const t = setup([], { now: 0 })
    const f = flushes()
    t.setDue(5000)
    await t.runner.rescheduleDue(f.run)
    t.setDue(20_000)
    t.timers.fire(6000)
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(f.count).toBe(1)
    expect(t.timers.delays()).toEqual([21_000])
  })

  it('keeps one timer, however often it is asked to arm', async () => {
    const t = setup([], { now: 0 })
    t.setDue(5000)
    await Promise.all([t.runner.rescheduleDue(flushes().run), t.runner.rescheduleDue(flushes().run), t.runner.rescheduleDue(flushes().run)])
    expect(t.timers.pending.size).toBe(1)
  })

  it('takes the timer away when stopped', async () => {
    const t = setup([], { now: 0 })
    t.setDue(5000)
    await t.runner.rescheduleDue(flushes().run)
    t.runner.stop()
    expect(t.timers.pending.size).toBe(0)
  })
})
