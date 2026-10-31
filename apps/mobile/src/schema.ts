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
  ['ALTER TABLE messages ADD COLUMN body_text TEXT', 'ALTER TABLE messages ADD COLUMN preview_text TEXT'],
  // 7. The tags the user has made, as the desktop has them: a name, the IMAP keyword that goes on the server, and a colour.
  // The tags of a message are its keywords, which are in its flags; this is only what they are called and how they look.
  [
    `CREATE TABLE tags (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL,
       keyword TEXT NOT NULL UNIQUE COLLATE NOCASE,
       color TEXT NOT NULL,
       sort_order INTEGER NOT NULL
     )`
  ],
  // 8. When a message that was put aside comes back, as the desktop keeps it: the moment, in epoch milliseconds, or null
  // for a message that is not. It is the phone's own, and is not written to the server: a message put aside here stays
  // where it is on the other devices. A moment that has passed is no snooze at all, so nothing has to clear it.
  ['ALTER TABLE messages ADD COLUMN snoozed_until INTEGER'],
  // 9. The OpenPGP keys. An account's own, with the private half kept open: the database is encrypted, which is what
  // protects it, as it protects the passwords, and a key that was sealed would ask for its passphrase at every message.
  // And the public keys of the people the user writes to, filed by address.
  [
    `CREATE TABLE own_keys (
       fingerprint TEXT PRIMARY KEY,
       account_id TEXT NOT NULL,
       public_key TEXT NOT NULL,
       private_key TEXT NOT NULL,
       created_at INTEGER NOT NULL
     )`,
    'CREATE INDEX idx_own_keys_account ON own_keys(account_id)',
    `CREATE TABLE contact_keys (
       fingerprint TEXT PRIMARY KEY,
       address TEXT NOT NULL,
       public_key TEXT NOT NULL,
       created_at INTEGER NOT NULL
     )`,
    'CREATE INDEX idx_contact_keys_address ON contact_keys(address)'
  ],
  // 10. The UIDVALIDITY a folder had when it was last synced, as text since it is a number of 32 bits that a script may not hold
  // whole. The UIDs of its messages mean something only as long as it is the same; null for a folder that was never synced since.
  ['ALTER TABLE folders ADD COLUMN uid_validity TEXT'],
  // 11. How many messages the server had in a folder at the last sync. What the phone has of them is the messages table, and the
  // difference is what there is to load: null for a folder that was never synced since this was kept.
  ['ALTER TABLE folders ADD COLUMN server_messages INTEGER'],
  // 12. The addresses an account sends under, each with its name and signature. Every account that is there gets the one it has always
  // had, from its own name and address, as the default, so that nothing changes until a second one is added.
  [
    `CREATE TABLE identities (
       id TEXT PRIMARY KEY,
       account_id TEXT NOT NULL,
       display_name TEXT NOT NULL DEFAULT '',
       email_address TEXT NOT NULL,
       signature TEXT NOT NULL DEFAULT '',
       is_default INTEGER NOT NULL DEFAULT 0,
       sort_order INTEGER NOT NULL DEFAULT 0
     )`,
    'CREATE INDEX idx_identities_account ON identities(account_id, sort_order)',
    `INSERT INTO identities (id, account_id, display_name, email_address, signature, is_default, sort_order)
     SELECT id || '-default', id, display_name, email_address, '', 1, 0 FROM accounts`
  ],
  // 13. The Message-ID of a message and the one it answers, which is what a conversation is made of. Null for the messages that were stored before this: they
  // are grouped by their subject until a sync fetches them again.
  ['ALTER TABLE messages ADD COLUMN message_id TEXT', 'ALTER TABLE messages ADD COLUMN in_reply_to TEXT'],
  // 14. The contacts the user keeps: a name and an address, which is what a vCard of the desktop's has. An address is one contact, whatever its case.
  [
    `CREATE TABLE contacts (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL DEFAULT '',
       email TEXT NOT NULL,
       created_at INTEGER NOT NULL
     )`,
    'CREATE UNIQUE INDEX idx_contacts_email ON contacts(lower(email))'
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
