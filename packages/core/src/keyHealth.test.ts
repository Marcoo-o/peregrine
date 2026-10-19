import { describe, expect, it } from 'vitest'
import { daysUntilExpiry, keyHealth, needsAttention } from './keyHealth'

const NOW = new Date('2026-08-08T12:00:00Z')

/** `days` from NOW, as an ISO string. */
function inDays(days: number): string {
  return new Date(NOW.getTime() + days * 86_400_000).toISOString()
}

describe('keyHealth', () => {
  it('is fine for a key without an expiry', () => {
    expect(keyHealth({ expiresAt: null }, NOW)).toBe('ok')
  })

  it('is fine while the expiry is far off', () => {
    expect(keyHealth({ expiresAt: inDays(400) }, NOW)).toBe('ok')
  })

  it('warns once the expiry is within four weeks', () => {
    expect(keyHealth({ expiresAt: inDays(27) }, NOW)).toBe('expiringSoon')
  })

  it('does not warn a day too early', () => {
    expect(keyHealth({ expiresAt: inDays(29) }, NOW)).toBe('ok')
  })

  it('reports an expiry in the past as expired', () => {
    expect(keyHealth({ expiresAt: inDays(-1) }, NOW)).toBe('expired')
  })

  // Revocation is a statement by the owner, not a deadline. It outranks any date.
  it('reports a revoked key as revoked, whatever its expiry says', () => {
    expect(keyHealth({ expiresAt: inDays(400), revoked: true }, NOW)).toBe('revoked')
    expect(keyHealth({ expiresAt: inDays(-1), revoked: true }, NOW)).toBe('revoked')
  })

  it('treats an unreadable date as no expiry rather than as expired', () => {
    expect(keyHealth({ expiresAt: 'übermorgen' }, NOW)).toBe('ok')
  })
})

describe('needsAttention', () => {
  it('is true for everything but ok', () => {
    expect(needsAttention('ok')).toBe(false)
    expect(needsAttention('expiringSoon')).toBe(true)
    expect(needsAttention('expired')).toBe(true)
    expect(needsAttention('revoked')).toBe(true)
  })
})

describe('daysUntilExpiry', () => {
  it('rounds up, so the last day reads as one day left', () => {
    expect(daysUntilExpiry(inDays(0.5), NOW)).toBe(1)
  })

  it('is null without an expiry', () => {
    expect(daysUntilExpiry(null, NOW)).toBeNull()
  })

  it('goes negative once the date has passed', () => {
    expect(daysUntilExpiry(inDays(-3), NOW)).toBe(-3)
  })
})
