import { isSQLCipher, open } from '@op-engineering/op-sqlite'
import type { SqlDb } from '@peregrine/core/sqlDb'
import { getDatabasePassphrase } from './native'
import { OpSqliteDb } from './OpSqliteDb'
import { migrate } from './schema'

let opening: Promise<SqlDb> | undefined

/**
 * The encrypted database, opened once for everything that runs in this process.
 *
 * Both the screens and the look for new mail that the platform starts while the application is closed
 * need it. They share a process when the application is open, and the look has one of its own when it is
 * not. A second connection to the same file in one process would only wait for the first. One that failed
 * is not kept, so that the next call tries again.
 */
export function openDatabase(): Promise<SqlDb> {
  opening ??= openEncrypted().catch((error: unknown) => {
    opening = undefined
    throw error
  })
  return opening
}

/**
 * Opens the database, making it on the first run.
 *
 * It refuses to open at all in a build without SQLCipher. op-sqlite takes a key in such a build and
 * ignores it, writing the database in the clear with no error, so the check is the only thing that
 * stands between a missing build flag and a mailbox sitting readable in the app's storage.
 */
async function openEncrypted(): Promise<SqlDb> {
  if (!isSQLCipher()) {
    throw new Error('This build has no SQLCipher, so the database would not be encrypted')
  }
  const key = await getDatabasePassphrase()
  const db = new OpSqliteDb(open({ name: 'peregrine.db', encryptionKey: key }))
  // A file that was made with another key fails here, and not on some later query.
  await db.get('SELECT count(*) AS tables FROM sqlite_master')
  await migrate(db)
  return db
}
