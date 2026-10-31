import type { SqlDb } from '@peregrine/core/sqlDb'
import { addressKey } from './keyStore'

/**
 * Which key is used when there is more than one: for an account, the key that signs, and for an address, the key that is encrypted to. What is not chosen is
 * the newest that can be used, which is what it was before there was a choice. A choice is a fingerprint; one that names a key that is gone is as if there was none.
 */
export interface KeyChoice {
  signing: Record<string, string>
  recipient: Record<string, string>
}

const NAME = 'pgpKeyChoice'
const EMPTY: KeyChoice = { signing: {}, recipient: {} }

const strings = (value: unknown): Record<string, string> => {
  if (typeof value !== 'object' || value === null) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

export async function loadKeyChoice(db: SqlDb): Promise<KeyChoice> {
  const row = await db.get<{ value: string }>('SELECT value FROM settings WHERE name = ?', NAME)
  if (!row) return EMPTY
  try {
    const given = JSON.parse(row.value) as { signing?: unknown; recipient?: unknown } | null
    return { signing: strings(given?.signing), recipient: strings(given?.recipient) }
  } catch {
    return EMPTY
  }
}

async function write(db: SqlDb, choice: KeyChoice): Promise<void> {
  await db.run(
    `INSERT INTO settings (name, value) VALUES (?, ?)
     ON CONFLICT (name) DO UPDATE SET value = excluded.value`,
    NAME,
    JSON.stringify(choice)
  )
}

/** The key that signs for an account is this one. */
export async function chooseSigningKey(db: SqlDb, accountId: string, fingerprint: string): Promise<void> {
  const choice = await loadKeyChoice(db)
  await write(db, { ...choice, signing: { ...choice.signing, [accountId]: fingerprint } })
}

/** The key that is encrypted to for this address is this one. */
export async function chooseRecipientKey(db: SqlDb, address: string, fingerprint: string): Promise<void> {
  const choice = await loadKeyChoice(db)
  await write(db, { ...choice, recipient: { ...choice.recipient, [addressKey(address)]: fingerprint } })
}

/** The keys with the chosen one first and the others as they were, so that the first that can be used is the chosen one when it can. */
export function preferFirst<T extends { fingerprint: string }>(keys: T[], fingerprint: string | undefined): T[] {
  if (fingerprint === undefined) return keys
  return [...keys.filter((key) => key.fingerprint === fingerprint), ...keys.filter((key) => key.fingerprint !== fingerprint)]
}

/** The key that is used of those held: the first, the chosen one ahead of the rest, that `usable` accepts; with none usable, the first, which is the one whose fault is told. */
export function activeKey<T extends { fingerprint: string }>(keys: T[], fingerprint: string | undefined, usable: (key: T) => boolean): T | undefined {
  const ordered = preferFirst(keys, fingerprint)
  return ordered.find(usable) ?? ordered[0]
}
