import type { SqlDb } from '@peregrine/core/sqlDb'

/**
 * The prototype's whole schema: one account and the headers of the messages seen so far.
 *
 * One account only, enforced by the table. The desktop's schema is far larger and is not
 * carried over; what the phone keeps will be decided together with what it syncs, in a later
 * stage. Each entry is one statement, because the driver runs one at a time.
 */
const MIGRATIONS: string[][] = [
  [
    `CREATE TABLE account (
       id INTEGER PRIMARY KEY CHECK (id = 1),
       host TEXT NOT NULL,
       port INTEGER NOT NULL,
       secure TEXT NOT NULL,
       username TEXT NOT NULL,
       password TEXT NOT NULL
     )`,
    `CREATE TABLE message (
       folder TEXT NOT NULL,
       uid INTEGER NOT NULL,
       subject TEXT NOT NULL,
       sender TEXT NOT NULL,
       date_ms INTEGER,
       flags TEXT NOT NULL,
       size INTEGER NOT NULL,
       has_attachment INTEGER NOT NULL,
       PRIMARY KEY (folder, uid)
     )`
  ]
]

/** Brings the database up to the newest schema, each step whole or not at all. */
export async function migrate(db: SqlDb): Promise<void> {
  const row = await db.get<{ user_version: number }>('PRAGMA user_version')
  for (let version = row?.user_version ?? 0; version < MIGRATIONS.length; version++) {
    await db.transaction(async (tx) => {
      for (const statement of MIGRATIONS[version]) await tx.run(statement)
      await tx.run(`PRAGMA user_version = ${version + 1}`)
    })
  }
}
