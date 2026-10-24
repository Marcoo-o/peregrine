import { describe, expect, it } from 'vitest'
import { fingerprintLines, keyFileName } from './keyText'

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
