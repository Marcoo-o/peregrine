import { describe, expect, it } from 'vitest'
import {
  astring,
  expandSequenceSet,
  flagList,
  isLiteral,
  mailbox,
  quote,
  sequenceSet
} from './commands'
import { decodeUtf8 } from './utf8'

describe('astring', () => {
  it('leaves an atom bare', () => {
    expect(astring('INBOX')).toBe('INBOX')
    expect(astring('user@example.com')).toBe('user@example.com')
  })

  it('quotes what is not an atom but is printable', () => {
    expect(astring('two words')).toBe('"two words"')
    expect(astring('say "hi"')).toBe('"say \\"hi\\""')
    expect(astring('back\\slash')).toBe('"back\\\\slash"')
    expect(astring('')).toBe('""')
    expect(astring('(paren)')).toBe('"(paren)"')
  })

  // A line break in a quoted string would end the command. It has to travel as a literal, where
  // the length decides where the value ends and the content is never read as syntax.
  it('sends a line break as a literal and not as syntax', () => {
    const arg = astring('evil\r\nA2 DELETE INBOX')
    expect(isLiteral(arg)).toBe(true)
    if (isLiteral(arg)) expect(decodeUtf8(arg.literal)).toBe('evil\r\nA2 DELETE INBOX')
  })

  it('sends non-ASCII text as a UTF-8 literal', () => {
    const arg = astring('pässwörd')
    expect(isLiteral(arg)).toBe(true)
    if (isLiteral(arg)) expect(decodeUtf8(arg.literal)).toBe('pässwörd')
  })

  it('refuses to quote what cannot be quoted', () => {
    expect(() => quote('a\nb')).toThrow()
  })
})

describe('mailbox', () => {
  it('encodes and quotes', () => {
    expect(mailbox('INBOX')).toBe('"INBOX"')
    expect(mailbox('Entwürfe')).toBe('"Entw&APw-rfe"')
    expect(mailbox('Projekte & Pläne')).toBe('"Projekte &- Pl&AOQ-ne"')
  })

  it('cannot be made to carry a quote out of its string', () => {
    expect(mailbox('a"b')).toBe('"a\\"b"')
    expect(mailbox('a\\b')).toBe('"a\\\\b"')
  })

  it('does not let a line break through', () => {
    // Not printable ASCII, so UTF-7 turns it into a run, which is.
    expect(mailbox('a\r\nb')).not.toMatch(/[\r\n]/)
  })
})

describe('flagList', () => {
  it('writes a list of flags', () => {
    expect(flagList(['\\Seen', '$label', 'Projekt_1'])).toBe('(\\Seen $label Projekt_1)')
    expect(flagList([])).toBe('()')
  })

  // The tags on a message are set by whoever wrote the client that set them.
  it('refuses a value that is not a flag', () => {
    for (const bad of ['a b', 'x)', '(x', 'a"b', 'a\r\nb', '\\', '', 'ä', '\\*', 'a%b', 'a{b']) {
      expect(() => flagList([bad]), JSON.stringify(bad)).toThrow(/Not a flag/)
    }
  })
})

describe('sequenceSet', () => {
  it('shortens runs', () => {
    expect(sequenceSet([1, 2, 3, 5, 7, 8])).toBe('1:3,5,7:8')
    expect(sequenceSet([4])).toBe('4')
    expect(sequenceSet([3, 1, 2, 2])).toBe('1:3')
  })

  it('refuses an empty set and numbers that are not UIDs', () => {
    expect(() => sequenceSet([])).toThrow()
    expect(() => sequenceSet([0])).toThrow()
    expect(() => sequenceSet([1, -2])).toThrow()
    expect(() => sequenceSet([1.5])).toThrow()
  })
})

describe('expandSequenceSet', () => {
  it('expands in the order written', () => {
    expect(expandSequenceSet('1:3,5')).toEqual([1, 2, 3, 5])
    expect(expandSequenceSet('7')).toEqual([7])
    expect(expandSequenceSet('3:1')).toEqual([3, 2, 1])
  })

  it('refuses something that is not a set and a set that is absurdly large', () => {
    expect(() => expandSequenceSet('1:*')).toThrow()
    expect(() => expandSequenceSet('a')).toThrow()
    expect(() => expandSequenceSet('1:9999999999')).toThrow(/too large/)
  })
})
