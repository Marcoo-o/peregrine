import Database from 'better-sqlite3-multiple-ciphers'
import { OpSqliteDb, type Connection } from '../OpSqliteDb'
import { migrate } from '../schema'

/**
 * An op-sqlite connection's shape over an ordinary SQLite, which answers on a later turn as the real
 * one does. Only for tests, and kept out of the application's type check, which has no Node.
 *
 * Going through `OpSqliteDb` and not straight to better-sqlite3 is deliberate: the phone's adapter
 * takes positional parameters only, so a test that runs the shared storage code through it also
 * shows that none of it uses a named one.
 */
export function fakeConnection(raw: Database.Database = new Database(':memory:')): {
  connection: Connection
  statements: string[]
  raw: Database.Database
} {
  const statements: string[] = []
  return {
    raw,
    statements,
    connection: {
      async execute(sql, params = []) {
        await Promise.resolve()
        statements.push(sql.trim().split(/\s+/)[0].toUpperCase())
        const statement = raw.prepare(sql)
        if (statement.reader) {
          return { rowsAffected: 0, rows: statement.all(...params) as never }
        }
        const result = statement.run(...params)
        return { rowsAffected: result.changes, insertId: Number(result.lastInsertRowid), rows: [] }
      }
    }
  }
}

/** A database at the newest schema, empty. */
export async function migratedDatabase() {
  const made = fakeConnection()
  const db = new OpSqliteDb(made.connection)
  await migrate(db)
  return { db, ...made }
}
