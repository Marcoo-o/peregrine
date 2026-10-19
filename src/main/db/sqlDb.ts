import { AsyncLocalStorage } from 'node:async_hooks'
import type Database from 'better-sqlite3-multiple-ciphers'
import type { RunResult, SqlDb } from '@peregrine/core/sqlDb'

export type { RunResult, SqlDb, SqlExecutor } from '@peregrine/core/sqlDb'

/** Prepared statements kept per SQL text. Search and paging build their SQL, so this is capped. */
const STATEMENT_CACHE_SIZE = 256

class Mutex {
  private tail: Promise<void> = Promise.resolve()

  acquire(): Promise<() => void> {
    const previous = this.tail
    let release!: () => void
    this.tail = new Promise<void>((resolve) => (release = resolve))
    return previous.then(() => release)
  }
}

/**
 * The desktop's database: better-sqlite3, one connection, calls taken strictly in turn.
 *
 * Being synchronous underneath is what makes the ordering cheap to promise. A statement runs to
 * completion before anything else is looked at, so the only thing that needs guarding is a
 * transaction, which spans several awaits.
 */
export class BetterSqliteDb implements SqlDb {
  private readonly lock = new Mutex()
  private readonly statements = new Map<string, Database.Statement>()
  // Which database the current async call chain is inside a transaction of. The flag next to
  // it matters: the chain carries the marker on after the transaction ends, to anything that was
  // started inside it and is still running.
  private readonly insideTransaction = new AsyncLocalStorage<BetterSqliteDb>()
  private transactionOpen = false

  constructor(private readonly raw: Database.Database) {}

  run(sql: string, ...params: unknown[]): Promise<RunResult> {
    return this.exclusive(() => runStatement(this.prepare(sql), params))
  }

  get<T>(sql: string, ...params: unknown[]): Promise<T | undefined> {
    return this.exclusive(() => this.prepare(sql).get(...params) as T | undefined)
  }

  all<T>(sql: string, ...params: unknown[]): Promise<T[]> {
    return this.exclusive(() => this.prepare(sql).all(...params) as T[])
  }

  async transaction<T>(fn: (tx: SqlDb) => Promise<T>): Promise<T> {
    this.refuseReentry()
    const release = await this.lock.acquire()
    this.transactionOpen = true
    let open = true
    const handle = (): Database.Database => {
      if (!open) throw new Error('This transaction is over, its handle can no longer be used')
      return this.raw
    }
    const tx: SqlDb = {
      run: async (sql, ...params) => runStatement(this.prepareOn(handle(), sql), params),
      get: async <R>(sql: string, ...params: unknown[]) =>
        this.prepareOn(handle(), sql).get(...params) as R | undefined,
      all: async <R>(sql: string, ...params: unknown[]) =>
        this.prepareOn(handle(), sql).all(...params) as R[],
      transaction: async <R>(inner: (tx: SqlDb) => Promise<R>) => {
        handle()
        return inner(tx)
      }
    }
    try {
      this.raw.exec('BEGIN')
      try {
        const result = await this.insideTransaction.run(this, () => fn(tx))
        this.raw.exec('COMMIT')
        return result
      } catch (err) {
        // A failed COMMIT has already ended the transaction, and rolling back then would
        // replace the real error with "no transaction is active".
        if (this.raw.inTransaction) this.raw.exec('ROLLBACK')
        throw err
      }
    } finally {
      open = false
      this.transactionOpen = false
      release()
    }
  }

  /**
   * Runs `fn` against the raw connection, with everything else held off. For the few things the
   * interface does not cover, such as changing the encryption key. The caller is the driver
   * specific part of the application, so it is allowed to know the type.
   */
  async withRawConnection<T>(fn: (raw: Database.Database) => T): Promise<T> {
    return this.exclusive(() => fn(this.raw))
  }

  close(): void {
    this.statements.clear()
    this.raw.close()
  }

  private async exclusive<T>(work: () => T): Promise<T> {
    this.refuseReentry()
    const release = await this.lock.acquire()
    try {
      return work()
    } finally {
      release()
    }
  }

  private refuseReentry(): void {
    if (this.transactionOpen && this.insideTransaction.getStore() === this) {
      throw new Error('The database was used inside its own transaction, use the handle it gave')
    }
  }

  private prepare(sql: string): Database.Statement {
    return this.prepareOn(this.raw, sql)
  }

  private prepareOn(raw: Database.Database, sql: string): Database.Statement {
    const cached = this.statements.get(sql)
    if (cached) {
      // Re-inserted so that the map's order is the order of last use.
      this.statements.delete(sql)
      this.statements.set(sql, cached)
      return cached
    }
    const statement = raw.prepare(sql)
    this.statements.set(sql, statement)
    if (this.statements.size > STATEMENT_CACHE_SIZE) {
      const oldest = this.statements.keys().next().value
      if (oldest !== undefined) this.statements.delete(oldest)
    }
    return statement
  }
}

function runStatement(statement: Database.Statement, params: unknown[]): RunResult {
  const { changes, lastInsertRowid } = statement.run(...params)
  return { changes, lastInsertRowid }
}
