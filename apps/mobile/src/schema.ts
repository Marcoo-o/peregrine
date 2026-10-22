import { PENDING_ACTIONS_SCHEMA } from '@peregrine/core/pendingActionsStore'
import type { SqlDb } from '@peregrine/core/sqlDb'

/**
 * The phone's schema, one entry for each version. An entry is never changed once it has been in a
 * build somebody installed: a database that is already at that version would not run it again, and
 * would differ from one that did. A change is a new entry at the end.
 *
 * Each entry is a list of statements, because the driver runs one at a time, and each entry runs as a
 * whole or not at all.
 */
const MIGRATIONS: string[][] = [
  // 1. The prototype: one account, and the headers of the messages seen so far.
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
  ],

  // 2. Several accounts, folders with an id of their own, and the offline queue.
  //
  // The account of the prototype is kept, with the login it was given, as the first of them. What
  // it did not have is not invented: the address is the user name when that looks like one, and
  // there are no settings for sending yet. Its message headers are a cache of what the server has and
  // are fetched again, which is cheaper than finding out which folder a path was meant to be.
  [
    `CREATE TABLE accounts (
       id TEXT PRIMARY KEY,
       display_name TEXT NOT NULL,
       email_address TEXT NOT NULL,
       imap_host TEXT NOT NULL,
       imap_port INTEGER NOT NULL,
       imap_secure TEXT NOT NULL,
       imap_username TEXT NOT NULL,
       smtp_host TEXT,
       smtp_port INTEGER,
       smtp_secure TEXT,
       smtp_username TEXT,
       password TEXT NOT NULL,
       smtp_password TEXT,
       created_at INTEGER NOT NULL
     )`,
    `INSERT INTO accounts (id, display_name, email_address, imap_host, imap_port, imap_secure,
                           imap_username, password, created_at)
     SELECT 'account-' || id, username,
            CASE WHEN instr(username, '@') > 0 THEN username ELSE '' END,
            host, port, secure, username, password, CAST(strftime('%s', 'now') AS INTEGER) * 1000
     FROM account`,
    'DROP TABLE account',
    'DROP TABLE message',
    // A folder has an id because the queue names a folder by it, and has to find its path on the
    // server. The path alone would do for finding, and not for a folder that is renamed.
    `CREATE TABLE folders (
       id TEXT PRIMARY KEY,
       account_id TEXT NOT NULL,
       imap_path TEXT NOT NULL,
       display_name TEXT NOT NULL,
       special_use TEXT,
       UNIQUE (account_id, imap_path)
     )`,
    `CREATE TABLE messages (
       folder_id TEXT NOT NULL,
       uid INTEGER NOT NULL,
       account_id TEXT NOT NULL,
       subject TEXT NOT NULL,
       sender TEXT NOT NULL,
       date_ms INTEGER,
       flags TEXT NOT NULL,
       size INTEGER NOT NULL,
       has_attachment INTEGER NOT NULL,
       pending_move_to TEXT,
       PRIMARY KEY (folder_id, uid)
     )`,
    'CREATE INDEX idx_folders_account ON folders(account_id)',
    'CREATE INDEX idx_messages_account ON messages(account_id)',
    ...PENDING_ACTIONS_SCHEMA
  ],
  // 3. What the user has set. One row for each group of settings, its value written as JSON, so that
  // a group can gain a setting without a migration: what is missing from a stored value is what it
  // was before the setting existed, and the code says what that is.
  ['CREATE TABLE settings (name TEXT PRIMARY KEY, value TEXT NOT NULL)'],
  // 4. The colour that tells an account from the others, as the desktop has it. The accounts that are
  // there are given one each in the order they were added, round robin through the six that
  // `@peregrine/core/accountColors` had when this was written. They are written out here and not
  // imported, because an entry of this list says what it did then and is not to change with the list.
  [
    "ALTER TABLE accounts ADD COLUMN color TEXT NOT NULL DEFAULT '#2f5d9f'",
    `UPDATE accounts SET color = CASE (
       SELECT COUNT(*) FROM accounts earlier
       WHERE earlier.created_at < accounts.created_at
          OR (earlier.created_at = accounts.created_at AND earlier.id < accounts.id)
     ) % 6
       WHEN 0 THEN '#2f5d9f' WHEN 1 THEN '#16736b' WHEN 2 THEN '#6341b8'
       WHEN 3 THEN '#a2650c' WHEN 4 THEN '#b03a5b' ELSE '#4a5568' END`
  ],
  // 5. Where a folder sits, which is what the folder tree is made from. The path of the folder it is in, as
  // the server spells it, or null at the top. A folder that is there already has none until the account's
  // folders are listed again, which they are when the account is opened, so the tree is flat until then.
  ['ALTER TABLE folders ADD COLUMN parent_path TEXT'],
  // 6. The text of a message, which is what the list shows the first of and what a search looks through. It is null
  // until the text has been fetched, and empty when it was fetched and there was none or it could not be read, so that
  // a message that fails is not tried again for ever.
  ['ALTER TABLE messages ADD COLUMN body_text TEXT', 'ALTER TABLE messages ADD COLUMN preview_text TEXT']
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
