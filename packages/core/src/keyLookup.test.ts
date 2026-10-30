import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { KEYSERVER_BASE, keyserverUrl, splitAddress, wkdUrls, zBase32Encode } from './keyLookup'

const sha1 = (bytes: Uint8Array): Uint8Array => new Uint8Array(createHash('sha1').update(bytes).digest())
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

describe('z-base-32', () => {
  it('writes five bits to a character, as the specification of WKD has it', () => {
    expect(zBase32Encode(new Uint8Array([]))).toBe('')
    // The vectors of the z-base-32 specification.
    expect(zBase32Encode(new Uint8Array([0xf0, 0xbf, 0xc7]))).toBe('6n9hq')
    expect(zBase32Encode(new Uint8Array([0xd4, 0x7a, 0x04]))).toBe('4t7ye')
    expect(zBase32Encode(new Uint8Array([0xff]))).toBe('9h')
  })
})

describe('an address', () => {
  it('is split at the last @, with the domain in lower case', () => {
    expect(splitAddress('Joe.Doe@Example.ORG')).toEqual({ localPart: 'Joe.Doe', domain: 'example.org' })
    expect(splitAddress('  a@b@Example.net ')).toEqual({ localPart: 'a@b', domain: 'example.net' })
  })

  it('is nothing when it has no local part or no domain', () => {
    expect(splitAddress('nobody')).toBeNull()
    expect(splitAddress('@example.org')).toBeNull()
    expect(splitAddress('joe@')).toBeNull()
  })
})

describe('where WKD publishes the key of an address', () => {
  it('is a file named by the hash of the local part, as the specification gives for Joe.Doe, on the subdomain first and on the domain after', () => {
    // The example of the WKD draft: the hash of "joe.doe" is iy9q119eutrkn8s1mk4r39qejnbu3n5q.
    expect(wkdUrls('Joe.Doe@Example.ORG', sha1, utf8)).toEqual([
      'https://openpgpkey.example.org/.well-known/openpgpkey/example.org/hu/iy9q119eutrkn8s1mk4r39qejnbu3n5q?l=Joe.Doe',
      'https://example.org/.well-known/openpgpkey/hu/iy9q119eutrkn8s1mk4r39qejnbu3n5q?l=Joe.Doe'
    ])
  })

  it('has the local part of the address in the query, written so that it cannot change the address', () => {
    const [advanced] = wkdUrls('a b&c@example.org', sha1, utf8)
    expect(advanced.endsWith('?l=a%20b%26c')).toBe(true)
  })

  it('has none for what is no address', () => {
    expect(wkdUrls('nobody', sha1, utf8)).toEqual([])
  })
})

describe('where the keyserver gives the key of an address', () => {
  it('is on keys.openpgp.org, by the address, written so that it cannot change the path', () => {
    expect(keyserverUrl(' joe@example.org ')).toBe(`${KEYSERVER_BASE}/vks/v1/by-email/joe%40example.org`)
    expect(keyserverUrl('a/b@example.org')).toBe(`${KEYSERVER_BASE}/vks/v1/by-email/a%2Fb%40example.org`)
  })
})
