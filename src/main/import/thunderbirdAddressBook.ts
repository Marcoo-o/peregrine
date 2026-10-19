import Database from 'better-sqlite3-multiple-ciphers'
import { copyFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  contactsFromAddressBookRows,
  type AddressBookRow
} from '@peregrine/core/thunderbirdAddressBook'
import type { VCardEntry } from '@peregrine/core/vcard'

/**
 * Reads the address books out of a Thunderbird profile.
 *
 * `abook.sqlite` is the personal one, `history.sqlite` the addresses Thunderbird collected
 * from sent mail by itself. Both are worth having, and a profile can hold further books
 * under `abook-1.sqlite` and so on, so every file matching the pattern is read.
 */

/** The books, in the order their contents should win over each other. */
function addressBookFiles(profilePath: string): string[] {
  let names: string[]
  try {
    names = readdirSync(profilePath)
  } catch {
    return []
  }

  const books = names.filter((name) => /^abook(-\d+)?\.sqlite$/.test(name))
  // The collected addresses last: a name typed by hand beats one picked off a message.
  if (names.includes('history.sqlite')) books.push('history.sqlite')
  return books.map((name) => join(profilePath, name))
}

/**
 * Reads one book.
 *
 * Onto a copy, never the file itself. Thunderbird may be running, and opening its database
 * directly would either fail on the lock or leave a `-wal` file behind in a foreign profile.
 * The copy is opened read-only and deleted afterwards either way.
 */
function readBook(path: string): AddressBookRow[] {
  const copy = join(tmpdir(), `peregrine-abook-${randomUUID()}.sqlite`)
  try {
    copyFileSync(path, copy)
    const db = new Database(copy, { readonly: true })
    try {
      return db.prepare('SELECT card, name, value FROM properties').all() as AddressBookRow[]
    } finally {
      db.close()
    }
  } catch (err) {
    console.error('reading Thunderbird address book failed:', err instanceof Error ? err.message : err)
    return []
  } finally {
    try {
      rmSync(copy, { force: true })
    } catch {
      // A leftover in the temp directory is not worth failing the import over.
    }
  }
}

export function readThunderbirdAddressBooks(profilePath: string): VCardEntry[] {
  if (!existsSync(profilePath)) return []
  const entries: VCardEntry[] = []
  for (const file of addressBookFiles(profilePath)) {
    entries.push(...contactsFromAddressBookRows(readBook(file)))
  }
  return entries
}
