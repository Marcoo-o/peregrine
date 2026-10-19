import type { SqlDb } from '../sqlDb'
import { randomUUID } from 'node:crypto'
import type { Identity, IdentityInput } from '@peregrine/core/types'

interface IdentityRow {
  id: string
  account_id: string
  display_name: string
  email_address: string
  signature: string
  is_default: number
  sort_order: number
}

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

export async function listIdentities(db: SqlDb, accountId?: string): Promise<Identity[]> {
  const rows = accountId
    ? await db.all<IdentityRow>(
        'SELECT * FROM identities WHERE account_id = ? ORDER BY is_default DESC, sort_order, email_address',
        accountId
      )
    : await db.all<IdentityRow>(
        'SELECT * FROM identities ORDER BY account_id, is_default DESC, sort_order, email_address'
      )
  return rows.map(toIdentity)
}

export async function getIdentity(db: SqlDb, identityId: string): Promise<Identity | undefined> {
  const row = await db.get<IdentityRow>('SELECT * FROM identities WHERE id = ?', identityId)
  return row ? toIdentity(row) : undefined
}

/** The identity a new message starts from when none was chosen. */
export async function getDefaultIdentity(
  db: SqlDb,
  accountId: string
): Promise<Identity | undefined> {
  const row = await db.get<IdentityRow>(
    'SELECT * FROM identities WHERE account_id = ? ORDER BY is_default DESC, sort_order LIMIT 1',
    accountId
  )
  return row ? toIdentity(row) : undefined
}

export async function createIdentity(db: SqlDb, input: IdentityInput): Promise<string> {
  const id = randomUUID()
  await db.transaction(async (tx) => {
    const nextOrder = (
      await tx.get<{ next: number }>(
        'SELECT COALESCE(MAX(sort_order), -1) + 1 as next FROM identities WHERE account_id = ?',
        input.accountId
      )
    )!.next

    await tx.run(
      `INSERT INTO identities (id, account_id, display_name, email_address, signature, is_default, sort_order)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
      id,
      input.accountId,
      input.displayName,
      input.emailAddress,
      input.signature,
      nextOrder
    )
  })
  return id
}

export async function updateIdentity(
  db: SqlDb,
  identityId: string,
  input: Partial<IdentityInput>
): Promise<void> {
  await db.transaction(async (tx) => {
    const existing = await getIdentity(tx, identityId)
    if (!existing) return
    await tx.run(
      'UPDATE identities SET display_name = ?, email_address = ?, signature = ? WHERE id = ?',
      input.displayName ?? existing.displayName,
      input.emailAddress ?? existing.emailAddress,
      input.signature ?? existing.signature,
      identityId
    )
  })
}

/**
 * Removes an identity, unless it is the last one of its account.
 *
 * An account without an identity could not send at all, and the compose window would have an
 * empty sender list with no way to fix it from there.
 */
export async function deleteIdentity(db: SqlDb, identityId: string): Promise<boolean> {
  // Counting, deleting and promoting a successor are one step. Two deletions at once would
  // each see two identities and leave the account with none.
  return db.transaction(async (tx) => {
    const identity = await getIdentity(tx, identityId)
    if (!identity) return false

    const count = (
      await tx.get<{ c: number }>(
        'SELECT COUNT(*) as c FROM identities WHERE account_id = ?',
        identity.accountId
      )
    )!.c
    if (count <= 1) return false

    await tx.run('DELETE FROM identities WHERE id = ?', identityId)

    // If the default went, promote the next one rather than leaving the account without one.
    if (identity.isDefault) {
      const next = await tx.get<{ id: string }>(
        'SELECT id FROM identities WHERE account_id = ? ORDER BY sort_order LIMIT 1',
        identity.accountId
      )
      if (next) await setDefaultIdentity(tx, next.id)
    }
    return true
  })
}

export async function setDefaultIdentity(db: SqlDb, identityId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const identity = await getIdentity(tx, identityId)
    if (!identity) return
    await tx.run('UPDATE identities SET is_default = 0 WHERE account_id = ?', identity.accountId)
    await tx.run('UPDATE identities SET is_default = 1 WHERE id = ?', identityId)
  })
}
