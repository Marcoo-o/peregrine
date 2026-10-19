import { describe, expect, it } from 'vitest'
import { isTagKeyword, keywordFor, parseFlags, tagKeywordsOf } from './tags'

describe('keywordFor', () => {
  it('leaves a plain name alone', () => {
    expect(keywordFor('Wichtig')).toBe('Wichtig')
  })

  // A tag that reads as line noise in another client is worse than one that lost its umlauts.
  it('folds German umlauts instead of dropping them', () => {
    expect(keywordFor('Für später')).toBe('Fuer_spaeter')
    expect(keywordFor('Größe')).toBe('Groesse')
  })

  it('strips accents from other letters', () => {
    expect(keywordFor('Café')).toBe('Cafe')
    expect(keywordFor('mañana')).toBe('manana')
  })

  // These are what make an IMAP atom invalid; sending them fails differently on every server.
  it('replaces the characters IMAP forbids', () => {
    expect(keywordFor('a(b)c')).toBe('a_b_c')
    expect(keywordFor('50% Rabatt')).toBe('50_Rabatt')
    expect(keywordFor('a"b\\c')).toBe('a_b_c')
    expect(keywordFor('Stern*')).toBe('Stern')
  })

  it('collapses runs and trims the edges', () => {
    expect(keywordFor('  viele   Lücken  ')).toBe('viele_Luecken')
  })

  it('never returns an empty keyword', () => {
    expect(keywordFor('%%%')).toBe('Tag')
    expect(keywordFor('')).toBe('Tag')
  })

  it('caps the length', () => {
    expect(keywordFor('a'.repeat(200))).toHaveLength(64)
  })
})

describe('isTagKeyword', () => {
  it('rejects system flags', () => {
    expect(isTagKeyword('\\Seen')).toBe(false)
    expect(isTagKeyword('\\Flagged')).toBe(false)
    expect(isTagKeyword('$Junk')).toBe(false)
    expect(isTagKeyword('$forwarded')).toBe(false)
  })

  it('accepts an ordinary keyword', () => {
    expect(isTagKeyword('Wichtig')).toBe(true)
    expect(isTagKeyword('$label1')).toBe(true)
  })
})

describe('tagKeywordsOf', () => {
  it('keeps only the tags', () => {
    expect(tagKeywordsOf(['\\Seen', 'Wichtig', '$Junk', 'Projekt'])).toEqual([
      'Wichtig',
      'Projekt'
    ])
  })
})

describe('parseFlags', () => {
  it('reads a stored list', () => {
    expect(parseFlags('["\\\\Seen","Wichtig"]')).toEqual(['\\Seen', 'Wichtig'])
  })

  it('survives anything unreadable', () => {
    expect(parseFlags(null)).toEqual([])
    expect(parseFlags('kaputt')).toEqual([])
    expect(parseFlags('{"a":1}')).toEqual([])
  })

  it('drops non-string entries', () => {
    expect(parseFlags('["Wichtig",5,null]')).toEqual(['Wichtig'])
  })
})
