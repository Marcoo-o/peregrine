import { describe, expect, it } from 'vitest'
import { fingerprintLines, healthTag, keyFileName, looksLikeKeyFile } from './keyText'

const FINGERPRINT = '0123456789abcdef0123456789abcdef01234567'

describe('a fingerprint as shown', () => {
  it('is in groups of four, in upper case, in two lines of five groups', () => {
    expect(fingerprintLines(FINGERPRINT)).toBe('0123 4567 89AB CDEF 0123\n4567 89AB CDEF 0123 4567')
  })

  it('is one line when it is short, and nothing for nothing', () => {
    expect(fingerprintLines('abcd1234')).toBe('ABCD 1234')
    expect(fingerprintLines('')).toBe('')
  })
})

describe('the name a public key is saved under', () => {
  it('is the address, to which the system adds the extension that goes with the kind of file', () => {
    expect(keyFileName('alex@example.org')).toBe('alex@example.org')
  })

  it('has nothing in it that a file name cannot hold', () => {
    expect(keyFileName('a b/c\\d@example.org')).toBe('a_b_c_d@example.org')
    expect(keyFileName('')).toBe('schluessel')
  })
})

describe('what is said of a key that is not in order', () => {
  const now = new Date('2026-10-28T12:00:00Z')
  const inDays = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString()

  it('is nothing for a key that is in order', () => {
    expect(healthTag({ expiresAt: null, revoked: false }, now)).toBeNull()
    expect(healthTag({ expiresAt: inDays(200), revoked: false }, now)).toBeNull()
  })

  it('is that it was withdrawn, whatever else is the case', () => {
    expect(healthTag({ expiresAt: inDays(-5), revoked: true }, now)).toEqual({ text: 'Widerrufen', tone: 'danger' })
  })

  it('is that it has expired', () => {
    expect(healthTag({ expiresAt: inDays(-1), revoked: false }, now)).toEqual({ text: 'Abgelaufen', tone: 'danger' })
  })

  it('is when it expires, once that is near, as a warning', () => {
    expect(healthTag({ expiresAt: inDays(10), revoked: false }, now)).toEqual({ text: 'Läuft in 10 Tagen ab', tone: 'warning' })
    expect(healthTag({ expiresAt: inDays(1), revoked: false }, now)?.text).toBe('Läuft morgen ab')
    expect(healthTag({ expiresAt: new Date(now.getTime() + 3_600_000).toISOString(), revoked: false }, now)?.text).toBe('Läuft morgen ab')
  })
})

describe('a file with keys in it', () => {
  const file = (filename: string, contentType = 'application/octet-stream') => ({ filename, contentType })

  it('is one that says so by its type, or by the ending of its name', () => {
    expect(looksLikeKeyFile(file('alex.txt', 'application/pgp-keys'))).toBe(true)
    expect(looksLikeKeyFile(file('alex.asc'))).toBe(true)
    expect(looksLikeKeyFile(file('ALEX.GPG'))).toBe(true)
    expect(looksLikeKeyFile(file('alex.pgp'))).toBe(true)
    expect(looksLikeKeyFile(file('alex.key'))).toBe(true)
  })

  it('is not an ordinary file, nor the signature of a message', () => {
    expect(looksLikeKeyFile(file('plan.pdf', 'application/pdf'))).toBe(false)
    expect(looksLikeKeyFile(file('signature.asc', 'application/pgp-signature'))).toBe(false)
  })
})
