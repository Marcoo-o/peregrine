import type { SqlDb } from '../sqlDb'
import type { ContactKeyInfo, ContactKeySource } from '@peregrine/core/types'
import { decryptSecret, encryptSecret } from '../../credentials/secureStore'

/**
 * The stored PGP keys, as a keyring per identity.
 *
 * Each account and each contact has exactly one *active* key. What signs, and what others
 * encrypt to. Alongside any number of retired ones. The retired keys are not clutter: mail
 * encrypted to an old key stays encrypted to it, and a signature made years ago can only be
 * checked against the key that made it. So reading uses every key while writing uses one.
 *
 * That split is the reason for the two shapes below: `get…Key` answers "what do I sign with",
 * `list…Keys` answers "what might this message need".
 */

export interface AccountPgpKey {
  publicKeyArmored: string
  privateKeyArmored: string
  fingerprint: string
}

interface AccountPgpKeyRow {
  public_key_armored: string
  private_key_encrypted: Buffer
  fingerprint: string
}

function toAccountKey(row: AccountPgpKeyRow): AccountPgpKey {
  return {
    publicKeyArmored: row.public_key_armored,
    privateKeyArmored: decryptSecret(row.private_key_encrypted),
    fingerprint: row.fingerprint
  }
}

/**
 * Stores a key and makes it the active one.
 *
 * Importing a key is always a statement about what to use from now on. Whatever was active
 * before stays in the ring, which is the whole point, but stops being what signs.
 */
export async function saveAccountPgpKey(
  db: SqlDb,
  accountId: string,
  publicKeyArmored: string,
  privateKeyArmored: string,
  fingerprint: string
): Promise<void> {
  const encrypted = encryptSecret(privateKeyArmored)
  await db.transaction(async (tx) => {
    await tx.run('UPDATE account_pgp_keys SET is_active = 0 WHERE account_id = ?', accountId)
    await tx.run(
      `INSERT INTO account_pgp_keys
         (account_id, fingerprint, public_key_armored, private_key_encrypted, is_active)
       VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(account_id, fingerprint) DO UPDATE SET
         public_key_armored = excluded.public_key_armored,
         private_key_encrypted = excluded.private_key_encrypted,
         is_active = 1`,
      accountId,
      fingerprint,
      publicKeyArmored,
      encrypted
    )
  })
}

/** The key this account signs and encrypts with. */
export async function getAccountPgpKey(
  db: SqlDb,
  accountId: string
): Promise<AccountPgpKey | undefined> {
  const row = await db.get<AccountPgpKeyRow>(
    'SELECT * FROM account_pgp_keys WHERE account_id = ? AND is_active = 1',
    accountId
  )
  return row ? toAccountKey(row) : undefined
}

/**
 * Every private key this account holds, newest first.
 *
 * Used for decryption, where the active key is only a good first guess: a message from before
 * the last rotation opens with a key that is no longer the one being handed out.
 */
export async function listAccountPrivateKeys(
  db: SqlDb,
  accountId: string
): Promise<AccountPgpKey[]> {
  const rows = await db.all<AccountPgpKeyRow>(
    `SELECT * FROM account_pgp_keys WHERE account_id = ?
     ORDER BY is_active DESC, created_at DESC`,
    accountId
  )
  return rows.map(toAccountKey)
}

export async function listAccountKeyInfos(
  db: SqlDb,
  accountId: string
): Promise<
  { fingerprint: string; isActive: boolean; createdAt: string; publicKeyArmored: string }[]
> {
  const rows = await db.all<{
    fingerprint: string
    is_active: number
    created_at: string
    public_key_armored: string
  }>(
    `SELECT fingerprint, is_active, created_at, public_key_armored FROM account_pgp_keys
     WHERE account_id = ? ORDER BY is_active DESC, created_at DESC`,
    accountId
  )
  return rows.map((r) => ({
    fingerprint: r.fingerprint,
    isActive: r.is_active === 1,
    createdAt: r.created_at,
    publicKeyArmored: r.public_key_armored
  }))
}

/** The fingerprint of every key held for an account, active or not. */
export async function listAccountKeyFingerprints(db: SqlDb): Promise<string[]> {
  const rows = await db.all<{ fingerprint: string }>('SELECT fingerprint FROM account_pgp_keys')
  return rows.map((row) => row.fingerprint)
}

export async function hasAccountPgpKey(db: SqlDb, accountId: string): Promise<boolean> {
  return (await db.get('SELECT 1 FROM account_pgp_keys WHERE account_id = ?', accountId)) != null
}

/**
 * Removes one key from an account's ring, or the whole ring.
 *
 * Deleting the active key promotes the next most recent one rather than leaving the account
 * with a ring it cannot sign from.
 */
export async function deleteAccountPgpKey(
  db: SqlDb,
  accountId: string,
  fingerprint?: string
): Promise<void> {
  if (!fingerprint) {
    await db.run('DELETE FROM account_pgp_keys WHERE account_id = ?', accountId)
    return
  }
  await db.transaction(async (tx) => {
    await tx.run(
      'DELETE FROM account_pgp_keys WHERE account_id = ? AND fingerprint = ?',
      accountId,
      fingerprint
    )
    await promoteAccountKeyIfNoneActive(tx, accountId)
  })
}

async function promoteAccountKeyIfNoneActive(db: SqlDb, accountId: string): Promise<void> {
  const active = await db.get(
    'SELECT 1 FROM account_pgp_keys WHERE account_id = ? AND is_active = 1',
    accountId
  )
  if (active) return
  await db.run(
    `UPDATE account_pgp_keys SET is_active = 1
     WHERE account_id = ? AND fingerprint = (
       SELECT fingerprint FROM account_pgp_keys WHERE account_id = ?
       ORDER BY created_at DESC LIMIT 1
     )`,
    accountId,
    accountId
  )
}

export async function setActiveAccountKey(
  db: SqlDb,
  accountId: string,
  fingerprint: string
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.run('UPDATE account_pgp_keys SET is_active = 0 WHERE account_id = ?', accountId)
    await tx.run(
      'UPDATE account_pgp_keys SET is_active = 1 WHERE account_id = ? AND fingerprint = ?',
      accountId,
      fingerprint
    )
  })
}

export async function deleteContactPgpKey(
  db: SqlDb,
  contactId: string,
  fingerprint?: string
): Promise<void> {
  if (!fingerprint) {
    await db.run('DELETE FROM contact_pgp_keys WHERE contact_id = ?', contactId)
    return
  }
  await db.transaction(async (tx) => {
    await tx.run(
      'DELETE FROM contact_pgp_keys WHERE contact_id = ? AND fingerprint = ?',
      contactId,
      fingerprint
    )
    const active = await tx.get(
      'SELECT 1 FROM contact_pgp_keys WHERE contact_id = ? AND is_active = 1',
      contactId
    )
    if (active) return
    await tx.run(
      `UPDATE contact_pgp_keys SET is_active = 1
       WHERE contact_id = ? AND fingerprint = (
         SELECT fingerprint FROM contact_pgp_keys WHERE contact_id = ?
         ORDER BY created_at DESC LIMIT 1
       )`,
      contactId,
      contactId
    )
  })
}

/** The active fingerprint per contact. What the contact list shows. */
export async function listContactKeyFingerprints(db: SqlDb): Promise<Record<string, string>> {
  const rows = await db.all<{ contact_id: string; fingerprint: string }>(
    'SELECT contact_id, fingerprint FROM contact_pgp_keys WHERE is_active = 1'
  )
  return Object.fromEntries(rows.map((r) => [r.contact_id, r.fingerprint]))
}

export async function getContactIdByEmail(db: SqlDb, email: string): Promise<string | undefined> {
  const row = await db.get<{ id: string }>('SELECT id FROM contacts WHERE email = ?', email)
  return row?.id
}

export async function saveContactPgpKey(
  db: SqlDb,
  contactId: string,
  publicKeyArmored: string,
  fingerprint: string,
  provenance?: { source: ContactKeySource; accountId?: string | null }
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.run('UPDATE contact_pgp_keys SET is_active = 0 WHERE contact_id = ?', contactId)
    await tx.run(
      `INSERT INTO contact_pgp_keys
         (contact_id, fingerprint, public_key_armored, source, discovered_for_account_id,
          updated_at, is_active)
       VALUES (?, ?, ?, ?, ?, datetime('now'), 1)
       ON CONFLICT(contact_id, fingerprint) DO UPDATE SET
         public_key_armored = excluded.public_key_armored,
         source = excluded.source,
         discovered_for_account_id = excluded.discovered_for_account_id,
         updated_at = excluded.updated_at,
         is_active = 1`,
      contactId,
      fingerprint,
      publicKeyArmored,
      provenance?.source ?? 'manual',
      provenance?.accountId ?? null
    )
  })
}

interface ContactKeyRow {
  contact_id: string
  email: string
  fingerprint: string
  source: string | null
  discovered_for_account_id: string | null
  updated_at: string | null
}

function toContactKeyInfo(row: ContactKeyRow): ContactKeyInfo {
  const source = row.source ?? 'manual'
  return {
    contactId: row.contact_id,
    email: row.email,
    fingerprint: row.fingerprint,
    // Anything unexpected reads as hand-entered: that is the weakest claim, and a stored
    // value nobody recognises should not be shown as the strongest one.
    source: source === 'wkd' || source === 'keyserver' ? source : 'manual',
    discoveredForAccountId: row.discovered_for_account_id,
    updatedAt: row.updated_at
  }
}

const CONTACT_KEY_COLUMNS = `pk.contact_id, c.email, pk.fingerprint, pk.source,
       pk.discovered_for_account_id, pk.updated_at`

/** What is known about the active key for one address. Null when there is none. */
export async function getContactKeyInfoByEmail(
  db: SqlDb,
  email: string
): Promise<ContactKeyInfo | null> {
  const row = await db.get<ContactKeyRow>(
    `SELECT ${CONTACT_KEY_COLUMNS}
     FROM contact_pgp_keys pk JOIN contacts c ON c.id = pk.contact_id
     WHERE c.email = ? COLLATE NOCASE AND pk.is_active = 1`,
    email
  )
  return row ? toContactKeyInfo(row) : null
}

export async function listContactKeyInfos(db: SqlDb): Promise<ContactKeyInfo[]> {
  const rows = await db.all<ContactKeyRow>(
    `SELECT ${CONTACT_KEY_COLUMNS}
     FROM contact_pgp_keys pk JOIN contacts c ON c.id = pk.contact_id
     WHERE pk.is_active = 1
     ORDER BY c.email`
  )
  return rows.map(toContactKeyInfo)
}

/** Every key stored for a contact, active first. For showing the ring. */
export async function listContactKeysFor(
  db: SqlDb,
  contactId: string
): Promise<{ fingerprint: string; isActive: boolean; source: string; createdAt: string }[]> {
  const rows = await db.all<{
    fingerprint: string
    is_active: number
    source: string
    created_at: string
  }>(
    `SELECT fingerprint, is_active, source, created_at FROM contact_pgp_keys
     WHERE contact_id = ? ORDER BY is_active DESC, created_at DESC`,
    contactId
  )
  return rows.map((r) => ({
    fingerprint: r.fingerprint,
    isActive: r.is_active === 1,
    source: r.source,
    createdAt: r.created_at
  }))
}

/** The contact's active public key. What a message to them is encrypted to. */
export async function getContactPgpKey(db: SqlDb, contactId: string): Promise<string | undefined> {
  const row = await db.get<{ public_key_armored: string }>(
    'SELECT public_key_armored FROM contact_pgp_keys WHERE contact_id = ? AND is_active = 1',
    contactId
  )
  return row?.public_key_armored
}

export async function getContactPgpKeyByEmail(
  db: SqlDb,
  email: string
): Promise<string | undefined> {
  const row = await db.get<{ public_key_armored: string }>(
    `SELECT pk.public_key_armored FROM contact_pgp_keys pk
     JOIN contacts c ON c.id = pk.contact_id
     WHERE c.email = ? COLLATE NOCASE AND pk.is_active = 1`,
    email
  )
  return row?.public_key_armored
}

/**
 * Every public key held for an address, active first.
 *
 * Verification uses all of them. A signature made before the sender rotated their key can only
 * be checked against the key that made it, and reporting "signature invalid" for a message
 * that was perfectly good would be worse than saying nothing.
 */
export async function listContactPublicKeysByEmail(db: SqlDb, email: string): Promise<string[]> {
  const rows = await db.all<{ public_key_armored: string }>(
    `SELECT pk.public_key_armored FROM contact_pgp_keys pk
     JOIN contacts c ON c.id = pk.contact_id
     WHERE c.email = ? COLLATE NOCASE
     ORDER BY pk.is_active DESC, pk.created_at DESC`,
    email
  )
  return rows.map((row) => row.public_key_armored)
}
