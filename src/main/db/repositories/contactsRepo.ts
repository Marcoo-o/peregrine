import type { SqlDb } from '../sqlDb'
import { randomUUID } from 'node:crypto'
import type { Contact } from '@peregrine/core/types'

interface ContactRow {
  id: string
  name: string
  email: string
  frequency: number
}

function toContact(row: ContactRow): Contact {
  return { id: row.id, name: row.name, email: row.email, frequency: row.frequency }
}

export async function listContacts(db: SqlDb, query?: string): Promise<Contact[]> {
  if (query && query.trim()) {
    const pattern = `%${query.trim()}%`
    const rows = await db.all<ContactRow>(
      `SELECT * FROM contacts WHERE name LIKE ? OR email LIKE ?
       ORDER BY frequency DESC, name ASC LIMIT 20`,
      pattern,
      pattern
    )
    return rows.map(toContact)
  }
  const rows = await db.all<ContactRow>(
    'SELECT * FROM contacts ORDER BY frequency DESC, name ASC LIMIT 200'
  )
  return rows.map(toContact)
}

// Called whenever a real address is observed (received mail, sent recipients) so the address
// book fills itself in over time instead of requiring manual entry.
export async function upsertContactFromMail(
  db: SqlDb,
  name: string,
  email: string
): Promise<void> {
  const trimmedEmail = email.trim()
  if (!trimmedEmail) return
  // Look, then update or insert: one step, or two mails from a new sender arriving together
  // both find no row and the second insert fails on the unique address.
  await db.transaction(async (tx) => {
    const existing = await tx.get<{ id: string; name: string }>(
      'SELECT id, name FROM contacts WHERE email = ?',
      trimmedEmail
    )

    if (existing) {
      await tx.run(
        `UPDATE contacts SET frequency = frequency + 1, last_used_at = datetime('now'),
         name = CASE WHEN name = '' THEN ? ELSE name END WHERE id = ?`,
        name.trim(),
        existing.id
      )
      return
    }

    await tx.run(
      `INSERT INTO contacts (id, name, email, frequency, last_used_at) VALUES (?, ?, ?, 1, datetime('now'))`,
      randomUUID(),
      name.trim(),
      trimmedEmail
    )
  })
}

export async function createContact(db: SqlDb, name: string, email: string): Promise<string> {
  const id = randomUUID()
  await db.run(
    `INSERT INTO contacts (id, name, email) VALUES (?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET name = excluded.name`,
    id,
    name.trim(),
    email.trim()
  )
  return id
}

export async function deleteContact(db: SqlDb, contactId: string): Promise<void> {
  await db.run('DELETE FROM contacts WHERE id = ?', contactId)
}

/** Every contact, unlimited and in a stable order, for writing an export file. */
export async function listAllContacts(db: SqlDb): Promise<Contact[]> {
  const rows = await db.all<ContactRow>('SELECT * FROM contacts ORDER BY name ASC, email ASC')
  return rows.map(toContact)
}

/**
 * Stores a batch of imported contacts and reports what happened to each.
 *
 * An address already known keeps its frequency and only gains a name if it had none. An
 * import is a merge, not a replacement: the counter is what the recipient suggestions are
 * ordered by, and throwing it away for a file that has no counter at all would make the
 * address book worse for having been exported and read back.
 */
export async function importContacts(
  db: SqlDb,
  entries: { name: string; email: string }[]
): Promise<{ added: number; updated: number; skipped: number }> {
  let added = 0
  let updated = 0
  let skipped = 0

  await db.transaction(async (tx) => {
    for (const entry of entries) {
      const email = entry.email.trim()
      const name = entry.name.trim()
      if (!email.includes('@')) {
        skipped += 1
        continue
      }
      const existing = await tx.get<{ id: string; name: string }>(
        'SELECT id, name FROM contacts WHERE email = ?',
        email
      )
      if (!existing) {
        await tx.run(
          'INSERT INTO contacts (id, name, email) VALUES (?, ?, ?)',
          randomUUID(),
          name,
          email
        )
        added += 1
        continue
      }
      if (!existing.name && name) {
        await tx.run(`UPDATE contacts SET name = ? WHERE id = ? AND name = ''`, name, existing.id)
        updated += 1
        continue
      }
      skipped += 1
    }
  })

  return { added, updated, skipped }
}
