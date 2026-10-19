/**
 * What the repositories need from a database, and nothing more.
 *
 * It is asynchronous because every SQLite driver on Android is, and the repositories would
 * otherwise have to be written twice. The desktop driver is not asynchronous. It answers
 * immediately, behind a promise.
 *
 * Parameters are passed the way better-sqlite3 takes them: positionally, or as one object when
 * the statement uses named parameters. A driver that cannot do the second has to translate.
 */
export interface SqlExecutor {
  run(sql: string, ...params: unknown[]): Promise<RunResult>
  get<T>(sql: string, ...params: unknown[]): Promise<T | undefined>
  all<T>(sql: string, ...params: unknown[]): Promise<T[]>
}

export interface RunResult {
  changes: number
  lastInsertRowid: number | bigint
}

export interface SqlDb extends SqlExecutor {
  /**
   * Runs `fn` as one unit: committed if it resolves, rolled back if it rejects.
   *
   * `fn` gets its own handle, and has to use it. Nothing else may touch the database while the
   * transaction is open, because on one connection a statement from another task would run
   * inside it and be undone by its rollback. Calls made on the outer handle wait until the
   * transaction is over, so using it from inside `fn` would wait forever. That is refused with an
   * error instead.
   *
   * The handle can start a transaction of its own, which then simply joins the one that is
   * open. That is what lets a function that needs its read and its write to be one step say so
   * for itself, without caring whether its caller has already opened a transaction.
   */
  transaction<T>(fn: (tx: SqlDb) => Promise<T>): Promise<T>
}
