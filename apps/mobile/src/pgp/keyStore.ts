import type { SqlDb } from '@peregrine/core/sqlDb'

/** An account's own key: both halves, the private one open. */
export interface OwnKey {
  fingerprint: string
  accountId: string
  publicKey: string
  privateKey: string
  createdAt: number
}

/** A public key of somebody the user writes to, filed under the address it was published for. */
export interface ContactKey {
  fingerprint: string
  address: string
  publicKey: string
  createdAt: number
}

interface OwnRow {
  fingerprint: string
  account_id: string
  public_key: string
  private_key: string
  created_at: number
}

interface ContactRow {
  fingerprint: string
  address: string
  public_key: string
  created_at: number
}

const toOwn = (row: OwnRow): OwnKey => ({
  fingerprint: row.fingerprint,
  accountId: row.account_id,
  publicKey: row.public_key,
  privateKey: row.private_key,
  createdAt: row.created_at
})

const toContact = (row: ContactRow): ContactKey => ({
  fingerprint: row.fingerprint,
  address: row.address,
  publicKey: row.public_key,
  createdAt: row.created_at
})

/** Addresses are compared without regard to case, as every mail system does it. */
export const addressKey = (address: string): string => address.trim().toLowerCase()

/**
 * The keys of an account, the newest first. The newest signs; all of them open a message, since mail that was
 * encrypted before a key was replaced is encrypted to the old one and has to stay readable.
 */
export async function listOwnKeys(db: SqlDb, accountId: string): Promise<OwnKey[]> {
  const rows = await db.all<OwnRow>(
    'SELECT fingerprint, account_id, public_key, private_key, created_at FROM own_keys WHERE account_id = ? ORDER BY created_at DESC, fingerprint',
    accountId
  )
  return rows.map(toOwn)
}

/** The key that signs for an account, or undefined when it has none. */
export async function signingKey(db: SqlDb, accountId: string): Promise<OwnKey | undefined> {
  return (await listOwnKeys(db, accountId))[0]
}

/** Keeps a key for an account. A key that is there already is replaced, which is how it is given the other half. */
export async function saveOwnKey(db: SqlDb, key: OwnKey): Promise<void> {
  await db.run(
    'INSERT OR REPLACE INTO own_keys (fingerprint, account_id, public_key, private_key, created_at) VALUES (?, ?, ?, ?, ?)',
    key.fingerprint,
    key.accountId,
    key.publicKey,
    key.privateKey,
    key.createdAt
  )
}

export async function removeOwnKey(db: SqlDb, accountId: string, fingerprint: string): Promise<void> {
  await db.run('DELETE FROM own_keys WHERE account_id = ? AND fingerprint = ?', accountId, fingerprint)
}

/** Every public key the user holds for people, by address and then by age. */
export async function listContactKeys(db: SqlDb): Promise<ContactKey[]> {
  const rows = await db.all<ContactRow>(
    'SELECT fingerprint, address, public_key, created_at FROM contact_keys ORDER BY address, created_at DESC'
  )
  return rows.map(toContact)
}

/** The public keys for an address, the newest first. More than one when the person has changed keys. */
export async function contactKeysFor(db: SqlDb, address: string): Promise<ContactKey[]> {
  const rows = await db.all<ContactRow>(
    'SELECT fingerprint, address, public_key, created_at FROM contact_keys WHERE address = ? ORDER BY created_at DESC',
    addressKey(address)
  )
  return rows.map(toContact)
}

/** Keeps a public key under an address. The same key under the same address is kept once. */
export async function saveContactKey(db: SqlDb, key: ContactKey): Promise<void> {
  await db.run(
    'INSERT OR REPLACE INTO contact_keys (fingerprint, address, public_key, created_at) VALUES (?, ?, ?, ?)',
    key.fingerprint,
    addressKey(key.address),
    key.publicKey,
    key.createdAt
  )
}

export async function removeContactKey(db: SqlDb, fingerprint: string): Promise<void> {
  await db.run('DELETE FROM contact_keys WHERE fingerprint = ?', fingerprint)
}
