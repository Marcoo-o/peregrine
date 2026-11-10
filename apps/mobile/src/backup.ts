import type { BackupCipher } from '@peregrine/core/backupFormat'
import type { SqlDb } from '@peregrine/core/sqlDb'
import type { FilterAction, FilterCondition } from '@peregrine/core/types'
import { decodeUtf8, encodeUtf8 } from '@peregrine/imap/utf8'
import { newId } from './ids'

/**
 * What a backup holds and how it is made and put back. The file it is written to is `@peregrine/core/backupFormat`: this is its content, which is a JSON document.
 *
 * What is in it is what the user made and would not get back from the server: the accounts, with their passwords only when asked for, the identities and signatures,
 * the OpenPGP keys (the private halves only when asked for), the contacts, the tags, the rules, the tasks, and the settings. What is not: the messages (the server
 * has them), what waits in the queue, the lock of the application and what is of this device (the registration for push, the quiet hours).
 *
 * Putting it back adds and never replaces: what is there already is left as it is and counted as there, so that a backup can be put back twice, onto a phone that is
 * in use, or onto one that is not, and nothing the user changed since is overwritten.
 */

export const BUNDLE_VERSION = 1

/** The settings a backup carries: how the application looks and behaves, not what belongs to one device. */
export const BACKED_UP_SETTINGS = ['appearance', 'fontScale', 'look', 'language', 'sort', 'conversations', 'safety', 'savedSearches', 'pgp', 'pgpKeyChoice', 'list', 'send'] as const

export interface BundleAccount {
  id: string
  displayName: string
  emailAddress: string
  imapHost: string
  imapPort: number
  imapSecure: string
  imapUsername: string
  smtpHost: string | null
  smtpPort: number | null
  smtpSecure: string | null
  smtpUsername: string | null
  /** Only when the user asked for the passwords to be in the file. */
  password?: string
  smtpPassword?: string | null
  color: string
  createdAt: number
}

export interface BundleIdentity {
  accountId: string
  displayName: string
  emailAddress: string
  signature: string
  isDefault: boolean
  sortOrder: number
}

export interface BundleOwnKey {
  fingerprint: string
  accountId: string
  publicKey: string
  /** Only when the user asked for the private keys to be in the file. */
  privateKey?: string
  createdAt: number
}

export interface BundleRule {
  accountId: string
  name: string
  matchMode: string
  conditions: FilterCondition[]
  /** A move says its folder by the path the server has for it, since the id is this phone's. */
  actions: Array<FilterAction & { targetPath?: string }>
  enabled: boolean
  sortOrder: number
}

export interface BundleTask {
  title: string
  notes: string
  recurrence: string
  startDay: string
  items: Array<{ title: string; doneOn: string | null }>
  completions: string[]
}

export interface BackupBundle {
  app: 'peregrine'
  version: number
  createdAt: number
  accounts: BundleAccount[]
  identities: BundleIdentity[]
  ownKeys: BundleOwnKey[]
  contactKeys: Array<{ fingerprint: string; address: string; publicKey: string; createdAt: number }>
  contacts: Array<{ name: string; email: string; createdAt: number }>
  tags: Array<{ name: string; keyword: string; color: string; sortOrder: number }>
  rules: BundleRule[]
  tasks: BundleTask[]
  settings: Record<string, string>
}

/** What goes into the file beyond what is always in it. */
export interface BackupOptions {
  passwords: boolean
  privateKeys: boolean
}

/** How many of each there are or were. */
export interface BackupCounts {
  accounts: number
  identities: number
  keys: number
  contacts: number
  tags: number
  rules: number
  tasks: number
  settings: number
}

export const NO_COUNTS: BackupCounts = { accounts: 0, identities: 0, keys: 0, contacts: 0, tags: 0, rules: 0, tasks: 0, settings: 0 }

export interface RestoreResult {
  /** What was new and is there now. */
  added: BackupCounts
  /** What was there already and was left as it was. */
  known: BackupCounts
  /** Rules whose folder is not on this phone (yet): a restore after the account has been connected puts them back. */
  rulesWithoutFolder: number
  /** Accounts that were added without a password, which cannot connect until one is given. */
  accountsWithoutPassword: number
  /** What is in the file that this version does not know, which is left out. */
  skipped: number
}

const parse = <T>(raw: string, fallback: T): T => {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export const countsOf = (bundle: BackupBundle): BackupCounts => ({
  accounts: bundle.accounts.length,
  identities: bundle.identities.length,
  keys: bundle.ownKeys.length + bundle.contactKeys.length,
  contacts: bundle.contacts.length,
  tags: bundle.tags.length,
  rules: bundle.rules.length,
  tasks: bundle.tasks.length,
  settings: Object.keys(bundle.settings).length
})

/** Reads what the phone has into a bundle. */
export async function collectBackup(db: SqlDb, options: BackupOptions, now: number = Date.now()): Promise<BackupBundle> {
  const accounts = await db.all<Record<string, unknown>>('SELECT * FROM accounts ORDER BY created_at, id')
  const folders = await db.all<{ id: string; imap_path: string }>('SELECT id, imap_path FROM folders')
  const pathOf = new Map(folders.map((folder) => [folder.id, folder.imap_path]))
  const tasks = await db.all<{ id: string; title: string; notes: string; recurrence: string; start_day: string }>('SELECT id, title, notes, recurrence, start_day FROM tasks ORDER BY sort_order, rowid')
  const settings: Record<string, string> = {}
  for (const name of BACKED_UP_SETTINGS) {
    const row = await db.get<{ value: string }>('SELECT value FROM settings WHERE name = ?', name)
    if (row) settings[name] = row.value
  }
  return {
    app: 'peregrine',
    version: BUNDLE_VERSION,
    createdAt: now,
    accounts: accounts.map((row) => ({
      id: row.id as string,
      displayName: row.display_name as string,
      emailAddress: row.email_address as string,
      imapHost: row.imap_host as string,
      imapPort: row.imap_port as number,
      imapSecure: row.imap_secure as string,
      imapUsername: row.imap_username as string,
      smtpHost: row.smtp_host as string | null,
      smtpPort: row.smtp_port as number | null,
      smtpSecure: row.smtp_secure as string | null,
      smtpUsername: row.smtp_username as string | null,
      ...(options.passwords ? { password: row.password as string, smtpPassword: row.smtp_password as string | null } : {}),
      color: row.color as string,
      createdAt: row.created_at as number
    })),
    identities: (await db.all<Record<string, unknown>>('SELECT * FROM identities ORDER BY account_id, is_default DESC, sort_order, id')).map((row) => ({
      accountId: row.account_id as string,
      displayName: row.display_name as string,
      emailAddress: row.email_address as string,
      signature: row.signature as string,
      isDefault: row.is_default === 1,
      sortOrder: row.sort_order as number
    })),
    ownKeys: (await db.all<Record<string, unknown>>('SELECT * FROM own_keys ORDER BY created_at, fingerprint')).map((row) => ({
      fingerprint: row.fingerprint as string,
      accountId: row.account_id as string,
      publicKey: row.public_key as string,
      ...(options.privateKeys ? { privateKey: row.private_key as string } : {}),
      createdAt: row.created_at as number
    })),
    contactKeys: (await db.all<Record<string, unknown>>('SELECT * FROM contact_keys ORDER BY address, created_at')).map((row) => ({
      fingerprint: row.fingerprint as string,
      address: row.address as string,
      publicKey: row.public_key as string,
      createdAt: row.created_at as number
    })),
    contacts: (await db.all<{ name: string; email: string; created_at: number }>('SELECT name, email, created_at FROM contacts ORDER BY created_at, id')).map((row) => ({
      name: row.name,
      email: row.email,
      createdAt: row.created_at
    })),
    tags: (await db.all<{ name: string; keyword: string; color: string; sort_order: number }>('SELECT name, keyword, color, sort_order FROM tags ORDER BY sort_order')).map((row) => ({
      name: row.name,
      keyword: row.keyword,
      color: row.color,
      sortOrder: row.sort_order
    })),
    rules: (await db.all<Record<string, unknown>>('SELECT * FROM filter_rules ORDER BY account_id, sort_order, rowid')).map((row) => ({
      accountId: row.account_id as string,
      name: row.name as string,
      matchMode: row.match_mode as string,
      conditions: parse<FilterCondition[]>(row.conditions_json as string, []),
      actions: parse<FilterAction[]>(row.actions_json as string, []).map((action) =>
        action.type === 'move' && action.targetFolderId ? { ...action, targetFolderId: undefined, targetPath: pathOf.get(action.targetFolderId) } : action
      ),
      enabled: row.enabled === 1,
      sortOrder: row.sort_order as number
    })),
    tasks: await Promise.all(
      tasks.map(async (task) => ({
        title: task.title,
        notes: task.notes,
        recurrence: task.recurrence,
        startDay: task.start_day,
        items: (await db.all<{ title: string; done_on: string | null }>('SELECT title, done_on FROM task_items WHERE task_id = ? ORDER BY sort_order, rowid', task.id)).map((item) => ({ title: item.title, doneOn: item.done_on })),
        completions: (await db.all<{ occurred_on: string }>('SELECT occurred_on FROM task_completions WHERE task_id = ? ORDER BY occurred_on', task.id)).map((row) => row.occurred_on)
      }))
    ),
    settings
  }
}

/** The bundle as the bytes that are sealed. */
export const bundleBytes = (bundle: BackupBundle): Uint8Array => encodeUtf8(JSON.stringify(bundle))

/** The file for a backup of what the phone has. */
export async function makeBackup(db: SqlDb, cipher: BackupCipher, password: string, options: BackupOptions): Promise<{ file: Uint8Array; counts: BackupCounts }> {
  const bundle = await collectBackup(db, options)
  return { file: await cipher.seal(bundleBytes(bundle), password), counts: countsOf(bundle) }
}

export type OpenedBackup = { bundle: BackupBundle } | { problem: 'password' | 'notBackup' | 'newer' }

const isList = (value: unknown): boolean => Array.isArray(value)

/** Opens a file: the bundle, or why not. A wrong password and a file that is not a backup are not told apart by the file, which does not say; one that opens but is not a bundle is. */
export async function openBackup(cipher: BackupCipher, file: Uint8Array, password: string): Promise<OpenedBackup> {
  const content = await cipher.open(file, password)
  if (content === null) return { problem: 'password' }
  let given: Partial<BackupBundle> | null
  try {
    given = JSON.parse(decodeUtf8(content)) as Partial<BackupBundle> | null
  } catch {
    return { problem: 'notBackup' }
  }
  if (!given || given.app !== 'peregrine' || typeof given.version !== 'number') return { problem: 'notBackup' }
  if (given.version > BUNDLE_VERSION) return { problem: 'newer' }
  // A list that a version left out is an empty one, so that an older file can be read.
  const list = <T>(value: T[] | undefined): T[] => (isList(value) ? (value as T[]) : [])
  return {
    bundle: {
      app: 'peregrine',
      version: given.version,
      createdAt: given.createdAt ?? 0,
      accounts: list(given.accounts),
      identities: list(given.identities),
      ownKeys: list(given.ownKeys),
      contactKeys: list(given.contactKeys),
      contacts: list(given.contacts),
      tags: list(given.tags),
      rules: list(given.rules),
      tasks: list(given.tasks),
      settings: given.settings && typeof given.settings === 'object' ? given.settings : {}
    }
  }
}

const lower = (text: string): string => text.trim().toLowerCase()
const accountKey = (account: { emailAddress: string; imapHost: string; imapUsername: string }): string => `${lower(account.emailAddress)}|${lower(account.imapHost)}|${lower(account.imapUsername)}`

/** Puts a bundle back, adding what is not there and leaving what is. */
export async function restoreBackup(db: SqlDb, bundle: BackupBundle): Promise<RestoreResult> {
  const added: BackupCounts = { ...NO_COUNTS }
  const known: BackupCounts = { ...NO_COUNTS }
  const result: RestoreResult = { added, known, rulesWithoutFolder: 0, accountsWithoutPassword: 0, skipped: 0 }

  await db.transaction(async (tx) => {
    // Accounts: one that is there (the same address, server and login) is the one the rest of the file belongs to; a new one gets an id of its own.
    const existing = await tx.all<{ id: string; email_address: string; imap_host: string; imap_username: string }>('SELECT id, email_address, imap_host, imap_username FROM accounts')
    const byKey = new Map(existing.map((row) => [accountKey({ emailAddress: row.email_address, imapHost: row.imap_host, imapUsername: row.imap_username }), row.id]))
    const idOf = new Map<string, string>()
    const fresh = new Set<string>()
    for (const account of bundle.accounts) {
      const there = byKey.get(accountKey(account))
      if (there) {
        idOf.set(account.id, there)
        known.accounts += 1
        continue
      }
      const id = newId()
      await tx.run(
        `INSERT INTO accounts (id, display_name, email_address, imap_host, imap_port, imap_secure, imap_username,
           smtp_host, smtp_port, smtp_secure, smtp_username, password, smtp_password, color, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, account.displayName, account.emailAddress, account.imapHost, account.imapPort, account.imapSecure, account.imapUsername,
        account.smtpHost, account.smtpPort, account.smtpSecure, account.smtpUsername, account.password ?? '', account.smtpPassword ?? null, account.color, account.createdAt
      )
      idOf.set(account.id, id)
      fresh.add(account.id)
      added.accounts += 1
      if (account.password === undefined) result.accountsWithoutPassword += 1
    }

    // Identities: those of an account that was added come as they were (its default among them); those of one that was there are added beside what it has.
    for (const identity of bundle.identities) {
      const accountId = idOf.get(identity.accountId)
      if (!accountId) {
        result.skipped += 1
        continue
      }
      const has = await tx.get('SELECT 1 AS found FROM identities WHERE account_id = ? AND lower(email_address) = ?', accountId, lower(identity.emailAddress))
      if (has) {
        known.identities += 1
        continue
      }
      const isDefault = fresh.has(identity.accountId) && identity.isDefault
      await tx.run(
        'INSERT INTO identities (id, account_id, display_name, email_address, signature, is_default, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
        newId(), accountId, identity.displayName, identity.emailAddress, identity.signature, isDefault ? 1 : 0, identity.sortOrder
      )
      added.identities += 1
    }
    // An account that was added and had no identity in the file still has to have one: the one a new message starts from.
    for (const account of bundle.accounts) {
      if (!fresh.has(account.id)) continue
      const accountId = idOf.get(account.id) as string
      const has = await tx.get('SELECT 1 AS found FROM identities WHERE account_id = ?', accountId)
      if (!has) {
        await tx.run('INSERT INTO identities (id, account_id, display_name, email_address, signature, is_default, sort_order) VALUES (?, ?, ?, ?, ?, 1, 0)', newId(), accountId, account.displayName, account.emailAddress, '')
        added.identities += 1
      }
    }

    // Keys: by fingerprint. A private half that the file has not is not made up, and a key without it is the public key only.
    for (const key of bundle.ownKeys) {
      const accountId = idOf.get(key.accountId)
      if (!accountId || key.privateKey === undefined) {
        // An own key without its private half is of no use as one, and the public half is kept with the others.
        if (accountId) {
          const changes = (await tx.run('INSERT OR IGNORE INTO contact_keys (fingerprint, address, public_key, created_at) VALUES (?, ?, ?, ?)', key.fingerprint, lower(bundle.accounts.find((a) => a.id === key.accountId)?.emailAddress ?? ''), key.publicKey, key.createdAt)).changes
          if (changes > 0) added.keys += 1
          else known.keys += 1
        } else result.skipped += 1
        continue
      }
      const changes = (await tx.run('INSERT OR IGNORE INTO own_keys (fingerprint, account_id, public_key, private_key, created_at) VALUES (?, ?, ?, ?, ?)', key.fingerprint, accountId, key.publicKey, key.privateKey, key.createdAt)).changes
      if (changes > 0) added.keys += 1
      else known.keys += 1
    }
    for (const key of bundle.contactKeys) {
      const changes = (await tx.run('INSERT OR IGNORE INTO contact_keys (fingerprint, address, public_key, created_at) VALUES (?, ?, ?, ?)', key.fingerprint, lower(key.address), key.publicKey, key.createdAt)).changes
      if (changes > 0) added.keys += 1
      else known.keys += 1
    }

    for (const contact of bundle.contacts) {
      const changes = (await tx.run('INSERT OR IGNORE INTO contacts (id, name, email, created_at) VALUES (?, ?, ?, ?)', newId(), contact.name, contact.email, contact.createdAt)).changes
      if (changes > 0) added.contacts += 1
      else known.contacts += 1
    }

    for (const tag of bundle.tags) {
      const next = await tx.get<{ n: number }>('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM tags')
      const changes = (await tx.run('INSERT OR IGNORE INTO tags (id, name, keyword, color, sort_order) VALUES (?, ?, ?, ?, ?)', newId(), tag.name, tag.keyword, tag.color, next?.n ?? tag.sortOrder)).changes
      if (changes > 0) added.tags += 1
      else known.tags += 1
    }

    // Rules: the folder of a move is found by its path among the folders of the account on this phone. A rule whose folder is not here is not made up.
    for (const rule of bundle.rules) {
      const accountId = idOf.get(rule.accountId)
      if (!accountId) {
        result.skipped += 1
        continue
      }
      const folders = await tx.all<{ id: string; imap_path: string }>('SELECT id, imap_path FROM folders WHERE account_id = ?', accountId)
      let missing = false
      const actions = rule.actions.map((action): FilterAction => {
        if (action.type !== 'move') return { type: action.type }
        const folder = folders.find((candidate) => candidate.imap_path === action.targetPath)
        if (!folder) missing = true
        return { type: 'move', targetFolderId: folder?.id }
      })
      if (missing) {
        result.rulesWithoutFolder += 1
        continue
      }
      const conditions = JSON.stringify(rule.conditions)
      const same = await tx.get('SELECT 1 AS found FROM filter_rules WHERE account_id = ? AND name = ? AND conditions_json = ? AND actions_json = ?', accountId, rule.name, conditions, JSON.stringify(actions))
      if (same) {
        known.rules += 1
        continue
      }
      const last = await tx.get<{ m: number | null }>('SELECT MAX(sort_order) AS m FROM filter_rules WHERE account_id = ?', accountId)
      await tx.run(
        'INSERT INTO filter_rules (id, account_id, name, match_mode, conditions_json, actions_json, enabled, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        newId(), accountId, rule.name, rule.matchMode, conditions, JSON.stringify(actions), rule.enabled ? 1 : 0, (last?.m ?? -1) + 1
      )
      added.rules += 1
    }

    for (const task of bundle.tasks) {
      const same = await tx.get('SELECT 1 AS found FROM tasks WHERE title = ? AND recurrence = ? AND start_day = ?', task.title, task.recurrence, task.startDay)
      if (same) {
        known.tasks += 1
        continue
      }
      const id = newId()
      const next = await tx.get<{ n: number }>('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM tasks')
      await tx.run('INSERT INTO tasks (id, title, notes, recurrence, start_day, sort_order) VALUES (?, ?, ?, ?, ?, ?)', id, task.title, task.notes, task.recurrence, task.startDay, next?.n ?? 1)
      for (const [index, item] of task.items.entries()) await tx.run('INSERT INTO task_items (id, task_id, title, done_on, sort_order) VALUES (?, ?, ?, ?, ?)', newId(), id, item.title, item.doneOn, index)
      for (const day of task.completions) await tx.run('INSERT OR IGNORE INTO task_completions (task_id, occurred_on) VALUES (?, ?)', id, day)
      added.tasks += 1
    }

    // Settings: only those a backup carries, and only where the phone has not set them itself.
    for (const [name, value] of Object.entries(bundle.settings)) {
      if (!(BACKED_UP_SETTINGS as readonly string[]).includes(name)) {
        result.skipped += 1
        continue
      }
      const changes = (await tx.run('INSERT OR IGNORE INTO settings (name, value) VALUES (?, ?)', name, value)).changes
      if (changes > 0) added.settings += 1
      else known.settings += 1
    }
  })
  return result
}
