import { describe, expect, it } from 'vitest'
import { contactsFromAddressBookRows, type AddressBookRow } from './thunderbirdAddressBook'

/** The shape a current Thunderbird writes: the whole card duplicated into a _vCard column. */
function modernCard(card: string, name: string, email: string): AddressBookRow[] {
  return [
    { card, name: 'DisplayName', value: name },
    { card, name: 'PrimaryEmail', value: email },
    { card, name: 'PopularityIndex', value: '15' },
    {
      card,
      name: '_vCard',
      value: ['BEGIN:VCARD', 'VERSION:4.0', `FN:${name}`, `EMAIL;PREF=1:${email}`, 'END:VCARD'].join(
        '\r\n'
      )
    }
  ]
}

describe('contactsFromAddressBookRows', () => {
  it('reads a card written by a current Thunderbird', () => {
    const rows = modernCard('c1', 'John', 'john@peregrine.example')
    expect(contactsFromAddressBookRows(rows)).toEqual([
      { name: 'John', email: 'john@peregrine.example' }
    ])
  })

  it('falls back to the columns for a card from an older version', () => {
    const rows: AddressBookRow[] = [
      { card: 'c1', name: 'FirstName', value: 'John' },
      { card: 'c1', name: 'LastName', value: 'Doe' },
      { card: 'c1', name: 'PrimaryEmail', value: 'john@peregrine.example' }
    ]
    expect(contactsFromAddressBookRows(rows)).toEqual([
      { name: 'John Doe', email: 'john@peregrine.example' }
    ])
  })

  it('takes the second address as its own contact', () => {
    const rows: AddressBookRow[] = [
      { card: 'c1', name: 'DisplayName', value: 'John' },
      { card: 'c1', name: 'PrimaryEmail', value: 'john@peregrine.example' },
      { card: 'c1', name: 'SecondEmail', value: 'privat@peregrine.example' }
    ]
    expect(contactsFromAddressBookRows(rows)).toEqual([
      { name: 'John', email: 'john@peregrine.example' },
      { name: 'John', email: 'privat@peregrine.example' }
    ])
  })

  it('falls back to the columns when the stored vCard is unusable', () => {
    const rows: AddressBookRow[] = [
      { card: 'c1', name: '_vCard', value: 'kaputt' },
      { card: 'c1', name: 'DisplayName', value: 'John' },
      { card: 'c1', name: 'PrimaryEmail', value: 'john@peregrine.example' }
    ]
    expect(contactsFromAddressBookRows(rows)).toEqual([
      { name: 'John', email: 'john@peregrine.example' }
    ])
  })

  it('keeps cards apart that arrive interleaved', () => {
    const rows = [
      ...modernCard('c1', 'Eins', 'eins@peregrine.example'),
      ...modernCard('c2', 'Zwei', 'zwei@peregrine.example')
    ].sort((a, b) => a.name.localeCompare(b.name))
    expect(contactsFromAddressBookRows(rows)).toHaveLength(2)
  })

  it('skips a card that has no address at all', () => {
    const rows: AddressBookRow[] = [{ card: 'c1', name: 'DisplayName', value: 'Nur ein Name' }]
    expect(contactsFromAddressBookRows(rows)).toEqual([])
  })

  it('returns nothing for an empty address book', () => {
    expect(contactsFromAddressBookRows([])).toEqual([])
  })
})
