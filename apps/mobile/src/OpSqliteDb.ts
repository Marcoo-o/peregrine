import type { RunResult, SqlDb } from '@peregrine/core/sqlDb'

type Scalar = string | number | boolean | null | ArrayBuffer | ArrayBufferView

/**
 * The part of an op-sqlite connection this uses. Narrow on purpose: a test can stand in for it
 * with another SQLite, and a change in the driver shows up in one place.
 */
export interface Connection {
  execute(
    sql: string,
    params?: Scalar[]
  ): Promise<{ rowsAffected: number; insertId?: number; rows: Array<Record<string, Scalar>> }>
}

class Mutex {
  private tail: Promise<void> = Promise.resolve()

  acquire(): Promise<() => void> {
    const previous = this.tail
    let release!: () => void
    this.tail = new Promise<void>((resolve) => (release = resolve))
    return previous.then(() => release)
  }
}

/** Positional parameters only. A named parameter object has to be translated by the caller. */
function positional(params: unknown[]): Scalar[] {
  for (const param of params) {
    if (param !== null && typeof param === 'object' && !ArrayBuffer.isView(param) && !(param instanceof ArrayBuffer)) {
      throw new Error('This driver takes positional parameters only')
    }
    if (param === undefined) throw new Error('A parameter is undefined')
    if (typeof param === 'bigint') throw new Error('A bigint cannot be bound as a parameter')
  }
  return params as Scalar[]
}

async function runOn(connection: Connection, sql: string, params: unknown[]): Promise<RunResult> {
  const result = await connection.execute(sql, positional(params))
  return { changes: result.rowsAffected, lastInsertRowid: result.insertId ?? 0 }
}

async function allOn<T>(connection: Connection, sql: string, params: unknown[]): Promise<T[]> {
  return (await connection.execute(sql, positional(params))).rows as unknown as T[]
}

/**
 * The phone's database: op-sqlite over SQLCipher, under the same `SqlDb` the desktop's is.
 *
 * Calls are taken strictly in turn, and a transaction holds the connection from `BEGIN` to the end,
 * so a statement from another task can never run inside it and be undone by its rollback. That is
 * what the repositories rely on, and the driver cannot give it unaided: op-sqlite answers on its own
 * threads.
 *
 * What is missing next to the desktop's is the guard against using the outer handle from inside a
 * transaction. The desktop catches that with `AsyncLocalStorage`, which Hermes does not have, so
 * here it waits for the lock that is held until it returns, and never does. Code written against
 * `SqlDb` uses the handle it is given, and the repositories do. Whether that is enough is one of
 * the questions the phone's first sync has to answer.
 */
export class OpSqliteDb implements SqlDb {
  private readonly lock = new Mutex()

  constructor(private readonly connection: Connection) {}

  async run(sql: string, ...params: unknown[]): Promise<RunResult> {
    const release = await this.lock.acquire()
    try {
      return await runOn(this.connection, sql, params)
    } finally {
      release()
    }
  }

  async get<T>(sql: string, ...params: unknown[]): Promise<T | undefined> {
    return (await this.all<T>(sql, ...params))[0]
  }

  async all<T>(sql: string, ...params: unknown[]): Promise<T[]> {
    const release = await this.lock.acquire()
    try {
      return await allOn<T>(this.connection, sql, params)
    } finally {
      release()
    }
  }

  async transaction<T>(fn: (tx: SqlDb) => Promise<T>): Promise<T> {
    const release = await this.lock.acquire()
    try {
      await this.connection.execute('BEGIN IMMEDIATE')
      const handle = new OpenTransaction(this.connection)
      let result: T
      try {
        result = await fn(handle)
      } catch (error) {
        handle.end()
        // A failed rollback must not hide the error that caused it.
        await this.connection.execute('ROLLBACK').catch(() => undefined)
        throw error
      }
      handle.end()
      await this.connection.execute('COMMIT')
      return result
    } finally {
      release()
    }
  }
}

/** What `fn` gets inside a transaction. It runs on the connection the transaction holds. */
class OpenTransaction implements SqlDb {
  private open = true

  constructor(private readonly connection: Connection) {}

  /** After the end it refuses, so something that outlived the transaction cannot run outside it. */
  end(): void {
    this.open = false
  }

  private check(): void {
    if (!this.open) throw new Error('The transaction is over')
  }

  async run(sql: string, ...params: unknown[]): Promise<RunResult> {
    this.check()
    return runOn(this.connection, sql, params)
  }

  async get<T>(sql: string, ...params: unknown[]): Promise<T | undefined> {
    this.check()
    return (await allOn<T>(this.connection, sql, params))[0]
  }

  async all<T>(sql: string, ...params: unknown[]): Promise<T[]> {
    this.check()
    return allOn<T>(this.connection, sql, params)
  }

  /** Joins the transaction that is open, which is what lets a function ask for one for itself. */
  async transaction<T>(fn: (tx: SqlDb) => Promise<T>): Promise<T> {
    this.check()
    return fn(this)
  }
}
