import { describe, expect, it } from 'vitest'
import { deriveKey, deriveVerifier, newSalt, verifierMatches } from './profileCrypto'

const SALT = '00112233445566778899aabbccddeeff'

describe('deriveKey', () => {
  it('is deterministic for the same password and salt', () => {
    expect(deriveKey('geheim', SALT)).toBe(deriveKey('geheim', SALT))
  })

  it('yields a different key for a different password', () => {
    expect(deriveKey('geheim', SALT)).not.toBe(deriveKey('geheim2', SALT))
  })

  // Without a per-profile salt, two profiles sharing a password would share a key, and one
  // cracked password would open both.
  it('yields a different key for the same password under another salt', () => {
    expect(deriveKey('geheim', SALT)).not.toBe(deriveKey('geheim', newSalt()))
  })

  it('produces a 256-bit key in hex', () => {
    expect(deriveKey('geheim', SALT)).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('deriveVerifier', () => {
  // The verifier sits in a readable file. If it were the key, storing it would give away
  // exactly what the encryption protects.
  it('is never the database key', () => {
    expect(deriveVerifier('geheim', SALT)).not.toBe(deriveKey('geheim', SALT))
  })

  it('is deterministic', () => {
    expect(deriveVerifier('geheim', SALT)).toBe(deriveVerifier('geheim', SALT))
  })
})

describe('verifierMatches', () => {
  const stored = deriveVerifier('richtig', SALT)

  it('accepts the right password', () => {
    expect(verifierMatches(stored, 'richtig', SALT)).toBe(true)
  })

  it('rejects a wrong password', () => {
    expect(verifierMatches(stored, 'falsch', SALT)).toBe(false)
  })

  it('rejects an empty password', () => {
    expect(verifierMatches(stored, '', SALT)).toBe(false)
  })

  it('rejects the right password under the wrong salt', () => {
    expect(verifierMatches(stored, 'richtig', newSalt())).toBe(false)
  })

  it('rejects a malformed stored value instead of throwing', () => {
    expect(verifierMatches('', 'richtig', SALT)).toBe(false)
    expect(verifierMatches('zz', 'richtig', SALT)).toBe(false)
  })
})

describe('newSalt', () => {
  it('does not repeat', () => {
    expect(newSalt()).not.toBe(newSalt())
  })
})
