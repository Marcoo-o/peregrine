import { beforeEach, describe, expect, it } from 'vitest'
import { OpSqliteDb } from './OpSqliteDb'
import { fakeConnection as connection } from './testing/testDb'

let db: OpSqliteDb
let statements: string[]

beforeEach(async () => {
  const made = connection()
  statements = made.statements
  db = new OpSqliteDb(made.connection)
  await db.run('CREATE TABLE note (id INTEGER PRIMARY KEY, text TEXT NOT NULL)')
})

describe('the plain calls', () => {
  it('writes and reads rows', async () => {
    const result = await db.run('INSERT INTO note (text) VALUES (?)', 'eins')
    expect(result).toEqual({ changes: 1, lastInsertRowid: 1 })
    await db.run('INSERT INTO note (text) VALUES (?)', 'zwei')
    expect(await db.all<{ text: string }>('SELECT text FROM note ORDER BY id')).toEqual([
      { text: 'eins' },
      { text: 'zwei' }
    ])
    expect(await db.get<{ text: string }>('SELECT text FROM note WHERE id = ?', 2)).toEqual({ text: 'zwei' })
  })

  it('answers get with nothing when there is no row', async () => {
    expect(await db.get('SELECT * FROM note WHERE id = ?', 99)).toBeUndefined()
  })

  it('refuses a named parameter object instead of binding nothing', async () => {
    await expect(db.run('INSERT INTO note (text) VALUES (@text)', { text: 'x' })).rejects.toThrow(
      /positional/
    )
  })

  it('refuses a parameter that cannot be bound instead of passing it on', async () => {
    await expect(db.run('INSERT INTO note (text) VALUES (?)', undefined)).rejects.toThrow(/undefined/)
    await expect(db.run('INSERT INTO note (text) VALUES (?)', 1n)).rejects.toThrow(/bigint/)
  })

  it('carries on after a statement failed', async () => {
    await expect(db.run('INSERT INTO nowhere VALUES (1)')).rejects.toThrow()
    await db.run('INSERT INTO note (text) VALUES (?)', 'danach')
    expect(await db.all('SELECT * FROM note')).toHaveLength(1)
  })
})

describe('transaction', () => {
  it('commits what the function did when it resolves', async () => {
    const value = await db.transaction(async (tx) => {
      await tx.run('INSERT INTO note (text) VALUES (?)', 'a')
      await tx.run('INSERT INTO note (text) VALUES (?)', 'b')
      return 42
    })
    expect(value).toBe(42)
    expect(await db.all('SELECT * FROM note')).toHaveLength(2)
  })

  it('rolls everything back when the function rejects, and rethrows that error', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.run('INSERT INTO note (text) VALUES (?)', 'a')
        throw new Error('abgebrochen')
      })
    ).rejects.toThrow('abgebrochen')
    expect(await db.all('SELECT * FROM note')).toHaveLength(0)
  })

  it('is not stuck after a rollback', async () => {
    await db.transaction(async () => {
      throw new Error('x')
    }).catch(() => undefined)
    await db.run('INSERT INTO note (text) VALUES (?)', 'weiter')
    expect(await db.all('SELECT * FROM note')).toHaveLength(1)
  })

  // The point of the lock. Without it the insert from outside would run between the two inserts
  // of the transaction and be undone with them.
  it('keeps a call from outside from running inside it', async () => {
    const inside = db.transaction(async (tx) => {
      await tx.run('INSERT INTO note (text) VALUES (?)', 'drinnen 1')
      await new Promise((resolve) => setTimeout(resolve, 20))
      await tx.run('INSERT INTO note (text) VALUES (?)', 'drinnen 2')
      throw new Error('zurückrollen')
    })
    const outside = db.run('INSERT INTO note (text) VALUES (?)', 'draußen')
    await expect(inside).rejects.toThrow('zurückrollen')
    await outside
    expect(await db.all<{ text: string }>('SELECT text FROM note')).toEqual([{ text: 'draußen' }])
    // BEGIN .. ROLLBACK is one unbroken stretch and the outside insert is after it
    const begin = statements.indexOf('BEGIN')
    const rollback = statements.indexOf('ROLLBACK')
    expect(statements.slice(begin, rollback + 1).filter((s) => s === 'INSERT')).toHaveLength(2)
    expect(statements.lastIndexOf('INSERT')).toBeGreaterThan(rollback)
  })

  it('lets two transactions run one after the other and not mixed', async () => {
    const order: string[] = []
    const first = db.transaction(async (tx) => {
      order.push('first start')
      await new Promise((resolve) => setTimeout(resolve, 10))
      await tx.run('INSERT INTO note (text) VALUES (?)', 'first')
      order.push('first end')
    })
    const second = db.transaction(async (tx) => {
      order.push('second start')
      await tx.run('INSERT INTO note (text) VALUES (?)', 'second')
      order.push('second end')
    })
    await Promise.all([first, second])
    expect(order).toEqual(['first start', 'first end', 'second start', 'second end'])
  })

  it('lets a transaction started inside one join it', async () => {
    await db
      .transaction(async (outer) => {
        await outer.run('INSERT INTO note (text) VALUES (?)', 'außen')
        await outer.transaction(async (inner) => {
          await inner.run('INSERT INTO note (text) VALUES (?)', 'innen')
        })
        throw new Error('alles zurück')
      })
      .catch(() => undefined)
    // one BEGIN only: the inner one did not start a transaction of its own
    expect(statements.filter((s) => s === 'BEGIN')).toHaveLength(1)
    expect(await db.all('SELECT * FROM note')).toHaveLength(0)
  })

  it('refuses a handle that outlived its transaction', async () => {
    let kept!: { run: (sql: string, ...params: unknown[]) => Promise<unknown> }
    await db.transaction(async (tx) => {
      kept = tx
    })
    await expect(kept.run('INSERT INTO note (text) VALUES (?)', 'zu spät')).rejects.toThrow(
      /over/
    )
    expect(await db.all('SELECT * FROM note')).toHaveLength(0)
  })
})
