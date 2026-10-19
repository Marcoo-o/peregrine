import { describe, expect, it } from 'vitest'
import { hasStructuredFilters, parseSearchQuery } from './searchQuery'

describe('parseSearchQuery', () => {
  it('treats plain input as free text', () => {
    expect(parseSearchQuery('exklusive tickets')).toEqual({ text: 'exklusive tickets' })
  })

  it('reads field operators in German and English', () => {
    expect(parseSearchQuery('von:versand').from).toBe('versand')
    expect(parseSearchQuery('from:versand').from).toBe('versand')
    expect(parseSearchQuery('an:john').to).toBe('john')
    expect(parseSearchQuery('betreff:rechnung').subject).toBe('rechnung')
  })

  it('keeps quoted phrases together', () => {
    expect(parseSearchQuery('betreff:"Ihre Rechnung"').subject).toBe('Ihre Rechnung')
    expect(parseSearchQuery('"exklusive tickets"').text).toBe('exklusive tickets')
  })

  it('separates operators from the remaining free text', () => {
    const parsed = parseSearchQuery('von:versand rechnung august')
    expect(parsed.from).toBe('versand')
    expect(parsed.text).toBe('rechnung august')
  })

  it('reads the boolean flags', () => {
    expect(parseSearchQuery('hat:anhang').hasAttachment).toBe(true)
    expect(parseSearchQuery('has:attachment').hasAttachment).toBe(true)
    expect(parseSearchQuery('ist:ungelesen').isUnread).toBe(true)
    expect(parseSearchQuery('is:starred').isFlagged).toBe(true)
  })

  it('accepts both date notations', () => {
    expect(parseSearchQuery('nach:2026-01-31').after).toBe('2026-01-31')
    expect(parseSearchQuery('vor:5.8.2026').before).toBe('2026-08-05')
  })

  it('leaves an unparsable date as free text instead of dropping it', () => {
    const parsed = parseSearchQuery('vor:gestern')
    expect(parsed.before).toBeUndefined()
    expect(parsed.text).toBe('vor:gestern')
  })

  it('narrows further when an operator repeats', () => {
    expect(parseSearchQuery('von:versand von:bonus').from).toBe('versand bonus')
  })

  it('leaves unknown operators as free text, so colons in words still search', () => {
    expect(parseSearchQuery('http://example.org').text).toBe('http://example.org')
    expect(parseSearchQuery('foo:bar').text).toBe('foo:bar')
  })

  it('ignores an operator without a value', () => {
    expect(parseSearchQuery('von:').from).toBeUndefined()
  })

  it('is case-insensitive for operators but keeps the value as typed', () => {
    expect(parseSearchQuery('VON:Bonusprogramm').from).toBe('Bonusprogramm')
  })
})

describe('hasStructuredFilters', () => {
  it('is false for free text only', () => {
    expect(hasStructuredFilters(parseSearchQuery('rechnung'))).toBe(false)
  })

  it('is true as soon as any operator is used', () => {
    expect(hasStructuredFilters(parseSearchQuery('ist:ungelesen'))).toBe(true)
    expect(hasStructuredFilters(parseSearchQuery('nach:2026-01-01'))).toBe(true)
  })
})
