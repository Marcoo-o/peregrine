import type { SqlDb } from '@peregrine/core/sqlDb'
import { parseAddress } from '@peregrine/smtp/headers'
import { written } from './draft'

/** A person the phone knows of: a name, which may be empty, and an address. */
export interface Contact {
  name: string
  address: string
}

/** The address book of the device, from which people are suggested. The native module is behind it. */
export interface DeviceContacts {
  /** Whether the address book may be read now, without asking. */
  permitted(): Promise<boolean>
  /** Whether it may be read, asking the user for the permission first where there is none. */
  ensurePermission(): Promise<boolean>
  /** The people whose name or address begins with what was typed, at most `limit`. */
  search(typed: string, limit: number): Promise<Contact[]>
}

/**
 * The people to suggest: those the phone has mail from first, since those are the ones written to, then the address book, each
 * address once whatever case it is written in, and at most `limit`. A person that is in both is shown with the name that the address
 * book has, which is the one the user gave them and is the more likely to be spelled right.
 */
export function mergeSuggestions(history: Contact[], book: Contact[], limit: number): Contact[] {
  const named = new Map(book.map((contact) => [contact.address.toLowerCase(), contact.name]))
  const seen = new Set<string>()
  const merged: Contact[] = []
  for (const contact of [...history, ...book]) {
    const key = contact.address.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    merged.push({ address: contact.address, name: named.get(key) || contact.name })
  }
  return merged.slice(0, limit)
}

/** How many messages are looked at for a typed part: a short part matches a great many, and only the best are shown. */
const CANDIDATES = 100

/** How many are suggested, which is what fits under a field without pushing the rest of the form out of sight. */
export const SUGGESTIONS = 4

/**
 * The part of a field that is being typed: what follows the last comma or semicolon, which is the address the user is
 * on. A name with a comma in it is in quotes when it is written here, so that after a suggestion the typing starts
 * after the separator, and what is in front of it is left alone.
 */
export function typedPart(text: string): { before: string; typed: string } {
  const at = Math.max(text.lastIndexOf(','), text.lastIndexOf(';'))
  return { before: text.slice(0, at + 1), typed: text.slice(at + 1).trim() }
}

/** The field with the part that was typed taken over by a contact, and a separator after it for the next one. */
export function withContact(text: string, contact: Contact): string {
  const { before } = typedPart(text)
  const lead = before === '' ? '' : `${before.trimEnd()} `
  return `${lead}${written(contact)}, `
}

interface Row {
  sender: string
  n: number
  last: number | null
}

/**
 * The people that match what was typed, from the senders of the messages the phone has, in any folder of any account.
 * The ones that sent most come first and then the latest. The user's own addresses are left out, since nobody writes
 * to themselves by suggestion, and so is an address that has been typed in full already, since there is nothing to add.
 */
export async function suggestContacts(db: SqlDb, typed: string, own: string[] = []): Promise<Contact[]> {
  const wanted = typed.trim().toLowerCase()
  if (wanted === '') return []
  // `instr` is no pattern, so nothing that can be typed in an address means anything but itself.
  const rows = await db.all<Row>(
    `SELECT sender, COUNT(*) AS n, MAX(date_ms) AS last FROM messages
     WHERE instr(lower(sender), ?) > 0 GROUP BY sender ORDER BY n DESC, last DESC LIMIT ?`,
    wanted,
    CANDIDATES
  )
  const excluded = new Set([...own.map((address) => address.trim().toLowerCase()), wanted])
  const people = new Map<string, { name: string; address: string; nameCount: number; n: number; last: number }>()
  for (const row of rows) {
    const { name, address } = parseAddress(row.sender)
    const key = address.trim().toLowerCase()
    if (!key.includes('@') || excluded.has(key)) continue
    const known = people.get(key)
    const last = row.last ?? 0
    if (!known) {
      people.set(key, { name: name ?? '', address: address.trim(), nameCount: name ? row.n : 0, n: row.n, last })
      continue
    }
    known.n += row.n
    known.last = Math.max(known.last, last)
    // The name that was used most is the one that is shown.
    if (name && row.n > known.nameCount) {
      known.name = name
      known.nameCount = row.n
    }
  }
  return [...people.values()]
    .sort((a, b) => b.n - a.n || b.last - a.last)
    .slice(0, SUGGESTIONS)
    .map(({ name, address }) => ({ name, address }))
}
