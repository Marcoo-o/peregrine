import type { SqlDb } from '@peregrine/core/sqlDb'
import { listAccounts } from '../accounts'
import { listOwnKeys } from './keyStore'

/** What the user wants of every message they write, unless they say otherwise for one. */
export interface ProtectionSettings {
  sign: boolean
  encrypt: boolean
}

export const DEFAULT_PROTECTION: ProtectionSettings = { sign: false, encrypt: false }

const NAME = 'pgp'

/** The settings as stored, with what is missing or is not a switch taking its default. */
export async function loadProtectionSettings(db: SqlDb): Promise<ProtectionSettings> {
  const row = await db.get<{ value: string }>('SELECT value FROM settings WHERE name = ?', NAME)
  if (!row) return DEFAULT_PROTECTION
  try {
    const given = JSON.parse(row.value) as Record<string, unknown> | null
    return {
      sign: typeof given?.sign === 'boolean' ? given.sign : DEFAULT_PROTECTION.sign,
      encrypt: typeof given?.encrypt === 'boolean' ? given.encrypt : DEFAULT_PROTECTION.encrypt
    }
  } catch {
    return DEFAULT_PROTECTION
  }
}

export async function saveProtectionSettings(db: SqlDb, change: Partial<ProtectionSettings>): Promise<ProtectionSettings> {
  const next = { ...(await loadProtectionSettings(db)), ...change }
  await db.run(
    `INSERT INTO settings (name, value) VALUES (?, ?)
     ON CONFLICT (name) DO UPDATE SET value = excluded.value`,
    NAME,
    JSON.stringify(next)
  )
  return next
}

/**
 * What a new message starts with: signed, encrypted, both or neither. It is read once and asked many times, since a message
 * is started without waiting for the database, so what it needs to know is kept here: the settings, and which accounts have a
 * key. An account without a key starts every message as it would have, since a message that was asked to be signed by an
 * account that cannot would be refused at once, for nothing the user asked.
 */
export class ProtectionDefaults {
  settings: ProtectionSettings = DEFAULT_PROTECTION
  private keyed = new Set<string>()

  constructor(private readonly db: SqlDb) {}

  /** Reads the settings and the accounts that have a key. Called when the application starts and whenever either changes. */
  async load(): Promise<void> {
    this.settings = await loadProtectionSettings(this.db)
    const keyed = new Set<string>()
    for (const account of await listAccounts(this.db)) if ((await listOwnKeys(this.db, account.id)).length > 0) keyed.add(account.id)
    this.keyed = keyed
  }

  async change(change: Partial<ProtectionSettings>): Promise<void> {
    this.settings = await saveProtectionSettings(this.db, change)
  }

  /** What a message from the account starts with: only the switches that are on are there. */
  forAccount(accountId: string): { sign?: true; encrypt?: true } {
    if (!this.keyed.has(accountId)) return {}
    return { ...(this.settings.sign ? { sign: true as const } : {}), ...(this.settings.encrypt ? { encrypt: true as const } : {}) }
  }
}
