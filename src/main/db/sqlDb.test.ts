import Database from 'better-sqlite3-multiple-ciphers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BetterSqliteDb, type SqlExecutor } from './sqlDb'

let db: BetterSqliteDb

beforeEach(() => {
  const raw = new Database(':memory:')
  raw.exec('CREATE TABLE note (id INTEGER PRIMARY KEY, body TEXT NOT NULL)')
  db = new BetterSqliteDb(raw)
})

afterEach(() => db.close())

const bodies = async (executor: SqlExecutor = db): Promise<string[]> =>
  (await executor.all<{ body: string }>('SELECT body FROM note ORDER BY id')).map((r) => r.body)

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('statements', () => {
  it('reads back what was written, positionally and by name', async () => {
    const first = await db.run('INSERT INTO note (body) VALUES (?)', 'one')
    await db.run('INSERT INTO note (body) VALUES (@body)', { body: 'two' })

    expect(Number(first.lastInsertRowid)).toBe(1)
    expect(first.changes).toBe(1)
    expect(await db.get('SELECT body FROM note WHERE id = ?', 2)).toEqual({ body: 'two' })
    expect(await db.get('SELECT body FROM note WHERE id = ?', 99)).toBeUndefined()
    expect(await bodies()).toEqual(['one', 'two'])
  })

  // Search and paging build their SQL from the query, so the set of distinct statements is
  // open ended. Going past the cache must evict, not fail.
  it('keeps working past the size of the statement cache', async () => {
    for (let i = 0; i < 600; i++) {
      expect(await db.get<{ n: number }>(`SELECT ${i} AS n`)).toEqual({ n: i })
    }
  })
})

describe('transactions', () => {
  it('commits what the function wrote', async () => {
    await db.transaction(async (tx) => {
      await tx.run('INSERT INTO note (body) VALUES (?)', 'a')
      await tx.run('INSERT INTO note (body) VALUES (?)', 'b')
    })
    expect(await bodies()).toEqual(['a', 'b'])
  })

  it('returns what the function returned', async () => {
    expect(await db.transaction(async () => 42)).toBe(42)
  })

  it('undoes everything when the function rejects, and passes the error on', async () => {
    await db.run('INSERT INTO note (body) VALUES (?)', 'kept')
    await expect(
      db.transaction(async (tx) => {
        await tx.run('INSERT INTO note (body) VALUES (?)', 'lost')
        throw new Error('half way')
      })
    ).rejects.toThrow('half way')
    expect(await bodies()).toEqual(['kept'])
  })

  // The case that makes a plain "await the repositories" wrong. A transaction that waits for
  // something lets other tasks run, and on one connection their statements would land inside it.
  it('holds off statements from other tasks until it is over', async () => {
    const seenInside: string[][] = []
    const transaction = db.transaction(async (tx) => {
      await tx.run('INSERT INTO note (body) VALUES (?)', 'inside')
      await pause(20)
      seenInside.push(await bodies(tx))
    })
    // Started while the transaction is waiting.
    await pause(5)
    const outside = db.run('INSERT INTO note (body) VALUES (?)', 'outside')

    await Promise.all([transaction, outside])

    expect(seenInside).toEqual([['inside']])
    expect(await bodies()).toEqual(['inside', 'outside'])
  })

  it('does not take a task\'s own write down with a rollback it was never part of', async () => {
    const transaction = db
      .transaction(async (tx) => {
        await tx.run('INSERT INTO note (body) VALUES (?)', 'inside')
        await pause(20)
        throw new Error('give up')
      })
      .catch(() => undefined)
    await pause(5)
    const outside = db.run('INSERT INTO note (body) VALUES (?)', 'outside')

    await Promise.all([transaction, outside])

    expect(await bodies()).toEqual(['outside'])
  })

  it('runs transactions one after the other', async () => {
    const order: string[] = []
    const make = (name: string) =>
      db.transaction(async (tx) => {
        order.push(`${name} start`)
        await tx.run('INSERT INTO note (body) VALUES (?)', name)
        await pause(5)
        order.push(`${name} end`)
      })

    await Promise.all([make('a'), make('b')])

    expect(order).toEqual(['a start', 'a end', 'b start', 'b end'])
  })

  // Waiting for a transaction from inside it would never finish, and a mail client that hangs
  // without a message is the worst way to find out that someone passed `db` instead of `tx`.
  it('refuses the outer handle inside a transaction rather than waiting forever', async () => {
    await expect(
      db.transaction(async () => {
        await db.get('SELECT 1')
      })
    ).rejects.toThrow(/inside its own transaction/)
    expect(await db.get<{ n: number }>('SELECT 1 AS n')).toEqual({ n: 1 })
  })

  // A function that reads and then writes has to be one step. It cannot know whether its caller
  // is already inside a transaction, so asking for one inside another has to be allowed.
  it('lets a transaction started inside a transaction join it', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.run('INSERT INTO note (body) VALUES (?)', 'outer')
        await tx.transaction(async (inner) => {
          await inner.run('INSERT INTO note (body) VALUES (?)', 'inner')
        })
        throw new Error('too late')
      })
    ).rejects.toThrow('too late')
    expect(await bodies()).toEqual([])
  })

  it('refuses a handle that outlived its transaction', async () => {
    let leaked!: SqlExecutor
    await db.transaction(async (tx) => {
      leaked = tx
    })
    await expect(leaked.get('SELECT 1')).rejects.toThrow(/is over/)
  })

  // Work started inside a transaction and still running after it carries its marker along.
  // That must not make the plain handle unusable for good.
  it('lets work that was started inside a transaction use the database afterwards', async () => {
    let late!: Promise<unknown>
    await db.transaction(async () => {
      late = pause(10).then(() => db.run('INSERT INTO note (body) VALUES (?)', 'late'))
    })
    await late
    expect(await bodies()).toEqual(['late'])
  })
})
