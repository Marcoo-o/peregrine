import { describe, expect, it } from 'vitest'
import { groupedFingerprint, keyFileName, shortFingerprint } from './keyText'

const FINGERPRINT = '0123456789abcdef0123456789abcdef01234567'

describe('a fingerprint as shown', () => {
  it('is its last sixteen characters in groups of four, in upper case', () => {
    expect(shortFingerprint(FINGERPRINT)).toBe('89AB CDEF 0123 4567')
  })

  it('is all of it in groups of four when it is to be compared', () => {
    expect(groupedFingerprint(FINGERPRINT)).toBe('0123 4567 89AB CDEF 0123 4567 89AB CDEF 0123 4567')
  })

  it('is nothing for nothing', () => {
    expect(shortFingerprint('')).toBe('')
    expect(groupedFingerprint('')).toBe('')
  })
})

describe('the file a public key is saved as', () => {
  it('is named for the address', () => {
    expect(keyFileName('alex@example.org')).toBe('alex@example.org.asc')
  })

  it('has nothing in its name that a file name cannot hold', () => {
    expect(keyFileName('a b/c\\d@example.org')).toBe('a_b_c_d@example.org.asc')
    expect(keyFileName('')).toBe('schluessel.asc')
  })
})
