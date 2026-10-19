import { isSQLCipher, open } from '@op-engineering/op-sqlite'
import type { SqlDb } from '@peregrine/core/sqlDb'
import { getDatabasePassphrase } from './native'
import { OpSqliteDb } from './OpSqliteDb'
import { migrate } from './schema'

/**
 * Opens the encrypted database, making it on the first run.
 *
 * It refuses to open at all in a build without SQLCipher. op-sqlite takes a key in such a build and
 * ignores it, writing the database in the clear with no error, so the check is the only thing that
 * stands between a missing build flag and a mailbox sitting readable in the app's storage.
 */
export async function openDatabase(): Promise<SqlDb> {
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
