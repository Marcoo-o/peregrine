import type { SqlDb } from '@peregrine/core/sqlDb'
import { newId } from './ids'

/**
 * A name and an address to send under. An account is a connection to a server; an identity is who a message says it is from,
 * so that one mailbox can answer as `info@` and by name over the same connection, which is how an alias works at the provider.
 * Every account has at least one, the one a new message starts from.
 */
export interface Identity {
  id: string
  accountId: string
  displayName: string
  emailAddress: string
  /** The text that goes under a message written from this identity, without the line that marks where it starts. */
  signature: string
  /** The one a new message starts from: exactly one for each account. */
  isDefault: boolean
  sortOrder: number
}

/** What an identity is made from. */
export type IdentityInput = Pick<Identity, 'accountId' | 'displayName' | 'emailAddress' | 'signature'>

interface IdentityRow {
  id: string
  account_id: string
  display_name: string
  email_address: string
  signature: string
  is_default: number
  sort_order: number
}

const COLUMNS = 'id, account_id, display_name, email_address, signature, is_default, sort_order'

function toIdentity(row: IdentityRow): Identity {
  return {
    id: row.id,
    accountId: row.account_id,
    displayName: row.display_name,
    emailAddress: row.email_address,
    signature: row.signature,
    isDefault: row.is_default === 1,
    sortOrder: row.sort_order
  }
}

/** The identities of one account, the default first and then in the order they were made. */
export async function listIdentities(db: SqlDb, accountId: string): Promise<Identity[]> {
  const rows = await db.all<IdentityRow>(
    `SELECT ${COLUMNS} FROM identities WHERE account_id = ? ORDER BY is_default DESC, sort_order, id`,
    accountId
  )
  return rows.map(toIdentity)
}

/** The identities of every account. */
export async function listAllIdentities(db: SqlDb): Promise<Identity[]> {
  const rows = await db.all<IdentityRow>(`SELECT ${COLUMNS} FROM identities ORDER BY account_id, is_default DESC, sort_order, id`)
  return rows.map(toIdentity)
}

export async function getIdentity(db: SqlDb, id: string): Promise<Identity | undefined> {
  const row = await db.get<IdentityRow>(`SELECT ${COLUMNS} FROM identities WHERE id = ?`, id)
  return row ? toIdentity(row) : undefined
}

/** Adds an identity. The first of an account is its default, and a later one is not until it is made one. */
export async function addIdentity(db: SqlDb, input: IdentityInput, options: { id?: string } = {}): Promise<Identity> {
  const id = options.id ?? newId()
  const count = await db.get<{ count: number; next: number }>(
    'SELECT COUNT(*) AS count, COALESCE(MAX(sort_order) + 1, 0) AS next FROM identities WHERE account_id = ?',
    input.accountId
  )
  const isDefault = (count?.count ?? 0) === 0
  await db.run(
    `INSERT INTO identities (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.accountId,
    input.displayName,
    input.emailAddress,
    input.signature,
    isDefault ? 1 : 0,
    count?.next ?? 0
  )
  return { ...input, id, isDefault, sortOrder: count?.next ?? 0 }
}

/** Changes the name, address and signature of an identity and returns it as stored, or undefined when it is not there. */
export async function updateIdentity(
  db: SqlDb,
  id: string,
  change: Partial<Pick<Identity, 'displayName' | 'emailAddress' | 'signature'>>
): Promise<Identity | undefined> {
  const current = await getIdentity(db, id)
  if (!current) return undefined
  const next = { ...current, ...change }
  await db.run(
    'UPDATE identities SET display_name = ?, email_address = ?, signature = ? WHERE id = ?',
    next.displayName,
    next.emailAddress,
    next.signature,
    id
  )
  return next
}

/** Makes an identity the one a new message of its account starts from, and the one that was is not any more. */
export async function setDefaultIdentity(db: SqlDb, id: string): Promise<void> {
  const identity = await getIdentity(db, id)
  if (!identity) return
  await db.transaction(async (tx) => {
    await tx.run('UPDATE identities SET is_default = 0 WHERE account_id = ?', identity.accountId)
    await tx.run('UPDATE identities SET is_default = 1 WHERE id = ?', id)
  })
}

/**
 * Takes an identity away. The last one of an account stays, since an account without one could not send, and false says so. When the
 * default is the one that goes, the first of those that are left becomes it.
 */
export async function removeIdentity(db: SqlDb, id: string): Promise<boolean> {
  const identity = await getIdentity(db, id)
  if (!identity) return false
  const others = (await listIdentities(db, identity.accountId)).filter((other) => other.id !== id)
  if (others.length === 0) return false
  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM identities WHERE id = ?', id)
    if (identity.isDefault) await tx.run('UPDATE identities SET is_default = 1 WHERE id = ?', others[0].id)
  })
  return true
}

/**
 * Lets the identity that an account was made with follow the account when its address or name is changed: the one that has the old address
 * gets the new, and the name when it was the account's name. An identity the user made, with an address of its own, is left alone.
 */
export async function followAccount(
  db: SqlDb,
  before: { id: string; displayName: string; emailAddress: string },
  after: { displayName: string; emailAddress: string }
): Promise<void> {
  if (before.emailAddress === after.emailAddress && before.displayName === after.displayName) return
  const match = (await listIdentities(db, before.id)).find((identity) => identity.emailAddress.toLowerCase() === before.emailAddress.toLowerCase())
  if (!match) return
  await updateIdentity(db, match.id, {
    emailAddress: after.emailAddress,
    displayName: match.displayName === before.displayName ? after.displayName : match.displayName
  })
}

/** The identity of an account that a new message starts from, or undefined for an account that has none. */
export async function defaultIdentity(db: SqlDb, accountId: string): Promise<Identity | undefined> {
  return (await listIdentities(db, accountId))[0]
}
