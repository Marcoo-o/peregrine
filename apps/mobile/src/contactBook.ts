import { parseVCards, serializeVCards } from '@peregrine/core/vcard'
import type { SqlDb } from '@peregrine/core/sqlDb'
import { newId } from './ids'
import type { Contact } from './contacts'

/** A person the user keeps: a name and an address, which is what a vCard of the desktop's has. */
export interface BookContact extends Contact {
  id: string
}

interface Row {
  id: string
  name: string
  email: string
}

const toContact = (row: Row): BookContact => ({ id: row.id, name: row.name, address: row.email })

/** The contacts by name, and by address for those without one, without regard to case. */
export async function listBook(db: SqlDb): Promise<BookContact[]> {
  const rows = await db.all<Row>('SELECT id, name, email FROM contacts ORDER BY lower(CASE WHEN name = \'\' THEN email ELSE name END), email')
  return rows.map(toContact)
}

export async function getBookContact(db: SqlDb, id: string): Promise<BookContact | undefined> {
  const row = await db.get<Row>('SELECT id, name, email FROM contacts WHERE id = ?', id)
  return row ? toContact(row) : undefined
}

/** The contact with an address, whatever the case, or undefined. */
export async function findBookContact(db: SqlDb, address: string): Promise<BookContact | undefined> {
  const row = await db.get<Row>('SELECT id, name, email FROM contacts WHERE lower(email) = lower(?)', address.trim())
  return row ? toContact(row) : undefined
}

const ADDRESS = /^[^\s@<>,;]+@[^\s@<>,;.]+(\.[^\s@<>,;.]+)+$/

/** Why an address cannot be kept, or null. */
export function addressProblem(address: string): string | null {
  return ADDRESS.test(address.trim()) ? null : 'Das ist keine E-Mail-Adresse.'
}

export type SaveResult = { saved: BookContact } | { problem: string }

/**
 * Keeps a contact. An address that is kept already is not kept twice: the name of the one that is there is made the new one when
 * this has one, and the one that is there is the answer. `id` names the contact that is being changed, which may then change its address
 * to one that no other has.
 */
export async function saveContact(db: SqlDb, input: { name: string; address: string }, id?: string): Promise<SaveResult> {
  const address = input.address.trim()
  const name = input.name.replace(/\s+/g, ' ').trim()
  const problem = addressProblem(address)
  if (problem) return { problem }
  const same = await findBookContact(db, address)
  if (id !== undefined) {
    if (same && same.id !== id) return { problem: 'Diese Adresse gehört schon zu einem anderen Kontakt.' }
    await db.run('UPDATE contacts SET name = ?, email = ? WHERE id = ?', name, address, id)
    const changed = await getBookContact(db, id)
    return changed ? { saved: changed } : { problem: 'Den Kontakt gibt es nicht mehr.' }
  }
  if (same) {
    if (name !== '' && name !== same.name) await db.run('UPDATE contacts SET name = ? WHERE id = ?', name, same.id)
    return { saved: (await getBookContact(db, same.id)) as BookContact }
  }
  const made = newId()
  await db.run('INSERT INTO contacts (id, name, email, created_at) VALUES (?, ?, ?, ?)', made, name, address, Date.now())
  return { saved: (await getBookContact(db, made)) as BookContact }
}

export async function removeContact(db: SqlDb, id: string): Promise<boolean> {
  const result = await db.run('DELETE FROM contacts WHERE id = ?', id)
  return Number(result.changes ?? 0) > 0
}

/**
 * Takes the cards of a vCard file as contacts, and says how many were new, how many were there already (their names filled in where the
 * contact had none) and how many were left out because they had no address that is one.
 */
export async function importVcards(db: SqlDb, text: string): Promise<{ added: number; known: number; skipped: number }> {
  let added = 0
  let known = 0
  let skipped = 0
  for (const entry of parseVCards(text)) {
    if (addressProblem(entry.email)) {
      skipped++
      continue
    }
    const before = await findBookContact(db, entry.email)
    const result = await saveContact(db, { name: before?.name ? before.name : entry.name, address: entry.email })
    if ('problem' in result) skipped++
    else if (before) known++
    else added++
  }
  return { added, known, skipped }
}

/** The contacts as a vCard file, all of them or the ones given. */
export function toVcards(contacts: ReadonlyArray<Contact>): string {
  return serializeVCards(contacts.map((contact) => ({ name: contact.name, email: contact.address })))
}

/** What a list of contacts is looked through for a typed part: the name or the address, any word of the name beginning with it, without regard to case. */
export function matchBook(contacts: readonly BookContact[], typed: string): BookContact[] {
  const part = typed.trim().toLowerCase()
  if (part === '') return [...contacts]
  return contacts.filter(
    (contact) => contact.address.toLowerCase().includes(part) || contact.name.toLowerCase().split(/\s+/).some((word) => word.startsWith(part))
  )
}
