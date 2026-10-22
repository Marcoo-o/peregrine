import { describe, expect, it } from 'vitest'
import { OpSqliteDb } from './OpSqliteDb'
import { migrate } from './schema'
import { fakeConnection } from './testing/testDb'

/** The prototype's schema, word for word, so that this keeps testing it however the code changes. */
const VERSION_1 = [
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

/** A database as the prototype left it, with an account and some messages. */
function installedPrototype(username = 'alex@example.org') {
  const made = fakeConnection()
  for (const statement of VERSION_1) made.raw.exec(statement)
  made.raw.exec('PRAGMA user_version = 1')
  made.raw
    .prepare('INSERT INTO account (id, host, port, secure, username, password) VALUES (1, ?, ?, ?, ?, ?)')
    .run('imap.example.org', 993, 'tls', username, 'the login')
  made.raw
    .prepare(
      `INSERT INTO message (folder, uid, subject, sender, date_ms, flags, size, has_attachment)
       VALUES ('INBOX', 7, 'Hello', 'Anna <anna@example.net>', 1000, '[]', 100, 0)`
    )
    .run()
  return { ...made, db: new OpSqliteDb(made.connection) }
}

const tables = (raw: ReturnType<typeof fakeConnection>['raw']): string[] =>
  (raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name)
const version = (raw: ReturnType<typeof fakeConnection>['raw']): number =>
  (raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version

describe('a new installation', () => {
  it('gets the newest schema and nothing of the old one', async () => {
    const made = fakeConnection()
    await migrate(new OpSqliteDb(made.connection))
    expect(tables(made.raw)).toEqual(['accounts', 'folders', 'messages', 'pending_actions', 'settings'])
    expect(version(made.raw)).toBe(5)
  })

  it('can be migrated again without harm, as it is at every start', async () => {
    const made = fakeConnection()
    const db = new OpSqliteDb(made.connection)
    await migrate(db)
    made.raw.prepare("INSERT INTO accounts (id, display_name, email_address, imap_host, imap_port, imap_secure, imap_username, password, created_at) VALUES ('a','a','','h',1,'tls','u','p',0)").run()
    await migrate(db)
    expect(version(made.raw)).toBe(5)
    expect((made.raw.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n).toBe(1)
  })
})

describe('the colours of accounts', () => {
  it('are given to the accounts there are, one each in the order they were added, round robin', async () => {
    const made = fakeConnection()
    const db = new OpSqliteDb(made.connection)
    await migrate(db)
    // The database as it was at version 3: without the colour, with accounts added out of order of their ids.
    made.raw.exec('ALTER TABLE accounts DROP COLUMN color')
    made.raw.exec('ALTER TABLE folders DROP COLUMN parent_path')
    made.raw.exec('PRAGMA user_version = 3')
    const insert = made.raw.prepare(
      "INSERT INTO accounts (id, display_name, email_address, imap_host, imap_port, imap_secure, imap_username, password, created_at) VALUES (?, ?, '', 'h', 1, 'tls', 'u', 'p', ?)"
    )
    for (let n = 0; n < 8; n++) insert.run(`id-${7 - n}`, `account ${n}`, 100 + n)

    await migrate(db)

    const rows = made.raw.prepare('SELECT display_name, color FROM accounts ORDER BY created_at').all() as { display_name: string; color: string }[]
    expect(rows.map((row) => row.color)).toEqual([
      '#2f5d9f', '#16736b', '#6341b8', '#a2650c', '#b03a5b', '#4a5568', '#2f5d9f', '#16736b'
    ])
  })
})

describe('where folders sit', () => {
  it('is a column of its own that folders that are there have empty until they are listed again', async () => {
    const made = fakeConnection()
    const db = new OpSqliteDb(made.connection)
    await migrate(db)
    made.raw.exec('ALTER TABLE folders DROP COLUMN parent_path')
    made.raw.exec('PRAGMA user_version = 4')
    made.raw.exec("INSERT INTO folders (id, account_id, imap_path, display_name, special_use) VALUES ('f', 'a', 'Projects/Phone', 'Phone', NULL)")

    await migrate(db)

    expect(made.raw.prepare('SELECT parent_path FROM folders').get()).toEqual({ parent_path: null })
    expect(version(made.raw)).toBe(5)
  })
})

describe('the migration from the prototype', () => {
  it('keeps the account with the login it was given', async () => {
    const { db, raw } = installedPrototype()
    await migrate(db)
    const rows = raw.prepare('SELECT * FROM accounts').all() as Record<string, unknown>[]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'account-1',
      display_name: 'alex@example.org',
      email_address: 'alex@example.org',
      imap_host: 'imap.example.org',
      imap_port: 993,
      imap_secure: 'tls',
      imap_username: 'alex@example.org',
      password: 'the login',
      smtp_host: null,
      smtp_password: null
    })
    expect(Number(rows[0].created_at)).toBeGreaterThan(1_700_000_000_000)
  })

  it('does not make up an address from a user name that is not one', async () => {
    const { db, raw } = installedPrototype('alex')
    await migrate(db)
    const row = raw.prepare('SELECT display_name, email_address FROM accounts').get() as { display_name: string; email_address: string }
    expect(row).toEqual({ display_name: 'alex', email_address: '' })
  })

  it('drops the cache of message headers and the old tables, and has the new ones', async () => {
    const { db, raw } = installedPrototype()
    await migrate(db)
    expect(tables(raw)).toEqual(['accounts', 'folders', 'messages', 'pending_actions', 'settings'])
    expect((raw.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number }).n).toBe(0)
    expect(version(raw)).toBe(5)
  })

  it('is whole or nothing: a failure part way leaves the prototype as it was', async () => {
    const { db, raw } = installedPrototype()
    // a table the migration is going to make, so that making it fails after the account was copied
    raw.exec('CREATE TABLE folders (id TEXT)')

    await expect(migrate(db)).rejects.toThrow(/folders/)

    expect(version(raw)).toBe(1)
    expect(tables(raw)).toEqual(['account', 'folders', 'message'])
    expect((raw.prepare('SELECT password FROM account').get() as { password: string }).password).toBe('the login')
    expect((raw.prepare('SELECT COUNT(*) AS n FROM message').get() as { n: number }).n).toBe(1)
  })
})
