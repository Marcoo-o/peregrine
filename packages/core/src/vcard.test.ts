import { describe, expect, it } from 'vitest'
import { parseVCards, serializeVCards } from './vcard'

/**
 * What Thunderbird writes when its address book is exported: version 3.0, the name both as
 * FN and as the structured N, and a folded line because the note ran long.
 */
const THUNDERBIRD = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'FN:John',
  'N:Doe;John;;;',
  'EMAIL;TYPE=INTERNET;PREF=1:john@peregrine.example',
  'NOTE:Ein Hinweis der so lang war dass er umgebroche',
  ' n werden musste',
  'END:VCARD',
  ''
].join('\r\n')

describe('parseVCards', () => {
  it('reads name and address out of a Thunderbird export', () => {
    expect(parseVCards(THUNDERBIRD)).toEqual([
      { name: 'John', email: 'john@peregrine.example' }
    ])
  })

  it('builds a display name from the structured field when FN is missing', () => {
    const card = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'N:Doe;John;Q.;;',
      'EMAIL:john@peregrine.example',
      'END:VCARD'
    ].join('\r\n')
    expect(parseVCards(card)).toEqual([
      { name: 'John Q. Doe', email: 'john@peregrine.example' }
    ])
  })

  it('splits a card with several addresses into one contact each', () => {
    const card = [
      'BEGIN:VCARD',
      'FN:Support',
      'EMAIL;TYPE=WORK:support@peregrine.example',
      'EMAIL;TYPE=HOME:hilfe@peregrine.example',
      'END:VCARD'
    ].join('\n')
    expect(parseVCards(card)).toEqual([
      { name: 'Support', email: 'support@peregrine.example' },
      { name: 'Support', email: 'hilfe@peregrine.example' }
    ])
  })

  it('skips a card without an address', () => {
    const card = ['BEGIN:VCARD', 'FN:Nur ein Name', 'END:VCARD'].join('\n')
    expect(parseVCards(card)).toEqual([])
  })

  it('strips the mailto prefix some exporters write', () => {
    const card = ['BEGIN:VCARD', 'FN:John', 'EMAIL:mailto:john@peregrine.example', 'END:VCARD'].join(
      '\n'
    )
    expect(parseVCards(card)).toEqual([{ name: 'John', email: 'john@peregrine.example' }])
  })

  it('leaves an encoded value alone instead of storing the encoding', () => {
    const card = [
      'BEGIN:VCARD',
      'FN;ENCODING=QUOTED-PRINTABLE:John D=C3=B6e',
      'EMAIL:john@peregrine.example',
      'END:VCARD'
    ].join('\n')
    // The name is dropped, the contact is not: an address without a name still works.
    expect(parseVCards(card)).toEqual([{ name: '', email: 'john@peregrine.example' }])
  })

  it('reads several cards from one file', () => {
    const file = THUNDERBIRD + ['BEGIN:VCARD', 'FN:Zweiter', 'EMAIL:zwei@peregrine.example', 'END:VCARD'].join('\r\n')
    expect(parseVCards(file)).toHaveLength(2)
  })

  it('returns nothing for a file that is not a vCard at all', () => {
    expect(parseVCards('Guten Tag, das hier ist eine E-Mail.')).toEqual([])
  })
})

describe('serializeVCards', () => {
  it('writes a card that can be read back unchanged', () => {
    const entries = [{ name: 'John', email: 'john@peregrine.example' }]
    expect(parseVCards(serializeVCards(entries))).toEqual(entries)
  })

  it('escapes a name containing a comma or a semicolon', () => {
    const entries = [{ name: 'Doe, John; privat', email: 'john@peregrine.example' }]
    const written = serializeVCards(entries)
    expect(written).toContain('FN:Doe\\, John\\; privat')
    expect(parseVCards(written)).toEqual(entries)
  })

  it('falls back to the address when there is no name', () => {
    expect(serializeVCards([{ name: '', email: 'john@peregrine.example' }])).toContain(
      'FN:john@peregrine.example'
    )
  })

  it('writes an empty string for an empty address book', () => {
    expect(serializeVCards([])).toBe('')
  })
})
