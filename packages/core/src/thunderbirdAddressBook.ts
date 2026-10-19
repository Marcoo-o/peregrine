import { parseVCards, type VCardEntry } from './vcard'

/** One row of Thunderbird's `properties` table: a card, a field name, a value. */
export interface AddressBookRow {
  card: string
  name: string
  value: string
}

/**
 * Turns the rows of a Thunderbird address book into contacts.
 *
 * Since version 102 each card also carries its own `_vCard` property, the whole card in the
 * standard format, and reading that is both less work and more faithful than reassembling it
 * from the individual columns. The columns are still there for cards written by an older
 * version and are used when the vCard is missing or unreadable.
 */
export function contactsFromAddressBookRows(rows: AddressBookRow[]): VCardEntry[] {
  const cards = new Map<string, Map<string, string>>()
  for (const row of rows) {
    let card = cards.get(row.card)
    if (!card) {
      card = new Map()
      cards.set(row.card, card)
    }
    card.set(row.name, row.value)
  }

  const entries: VCardEntry[] = []
  for (const card of cards.values()) {
    const vcard = card.get('_vCard')
    if (vcard) {
      const parsed = parseVCards(vcard)
      if (parsed.length > 0) {
        entries.push(...parsed)
        continue
      }
    }

    const name =
      card.get('DisplayName') ??
      [card.get('FirstName'), card.get('LastName')].filter((part) => part).join(' ')
    // Both address columns, since the second one is a real address and not a duplicate.
    for (const key of ['PrimaryEmail', 'SecondEmail']) {
      const email = card.get(key)?.trim()
      if (email && email.includes('@')) entries.push({ name: name ?? '', email })
    }
  }

  return entries
}
