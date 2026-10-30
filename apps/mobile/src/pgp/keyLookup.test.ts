import { beforeAll, describe, expect, it } from 'vitest'
import * as openpgp from 'openpgp'
import { KeyLookupError, lookupKey, type Fetcher } from './keyLookup'
import { generateKeyPair, type KeyPair } from './pgpService'

let sam: KeyPair
let other: KeyPair

beforeAll(async () => {
  sam = await generateKeyPair('Sam', 'sam@example.net')
  other = await generateKeyPair('Kim', 'kim@example.org')
})

const binary = async (armored: string): Promise<Uint8Array> => (await openpgp.readKey({ armoredKey: armored })).write()
const buffer = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
const answer = (bytes: Uint8Array | string, ok = true) => {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes
  return { ok, arrayBuffer: async () => buffer(data) }
}

/** A fetcher that answers by the address it is asked for, and keeps what it was asked. */
function web(answers: Record<string, ReturnType<typeof answer> | 'down'>) {
  const asked: string[] = []
  const fetcher: Fetcher = async (url) => {
    asked.push(url)
    const given = answers[url] ?? answers['*']
    if (given === undefined || given === 'down') throw new Error('network down')
    return given
  }
  return { fetcher, asked }
}

const ADVANCED = /^https:\/\/openpgpkey\.example\.net\/\.well-known\/openpgpkey\/example\.net\/hu\/[a-z0-9]{32}\?l=[Ss]am$/
const DIRECT = /^https:\/\/example\.net\/\.well-known\/openpgpkey\/hu\/[a-z0-9]{32}\?l=[Ss]am$/

describe('looking for the key of an address', () => {
  it('takes the key that the domain publishes by WKD, which is binary, and asks nothing else', async () => {
    const bytes = await binary(sam.publicKey)
    const asked: string[] = []
    const fetcher: Fetcher = async (url) => {
      asked.push(url)
      if (ADVANCED.test(url)) return answer(bytes)
      throw new Error('network down')
    }
    const found = await lookupKey('Sam@Example.NET', fetcher)
    expect(found.source).toBe('WKD')
    expect(found.keys.map((key) => key.fingerprint)).toEqual([sam.fingerprint])
    expect(asked).toHaveLength(1)
  })

  it('goes to the domain itself when the subdomain has none, and then to the keyserver', async () => {
    const asked: string[] = []
    const fetcher: Fetcher = async (url) => {
      asked.push(url)
      if (url.includes('keys.openpgp.org')) return answer(sam.publicKey)
      return answer('not found', false)
    }
    const found = await lookupKey('sam@example.net', fetcher)
    expect(found.source).toBe('keys.openpgp.org')
    expect(asked).toHaveLength(3)
    expect(asked[0]).toMatch(ADVANCED)
    expect(asked[1]).toMatch(DIRECT)
    expect(asked[2]).toBe('https://keys.openpgp.org/vks/v1/by-email/sam%40example.net')
  })

  it('goes on when a server gives a page and not a key, as hosts with a catch-all route do', async () => {
    const fetcher: Fetcher = async (url) => (url.includes('keys.openpgp.org') ? answer(sam.publicKey) : answer('<html>Welcome</html>'))
    expect((await lookupKey('sam@example.net', fetcher)).source).toBe('keys.openpgp.org')
  })

  it('does not take a key that is not for the address that was asked for, which a server may give for any', async () => {
    const fetcher: Fetcher = async () => answer(await binary(other.publicKey))
    await expect(lookupKey('sam@example.net', fetcher)).rejects.toMatchObject({ failure: 'notFound' })
  })

  it('keeps of a file with several keys those that name the address', async () => {
    const both = new Uint8Array([...(await binary(sam.publicKey)), ...(await binary(other.publicKey))])
    const found = await lookupKey('sam@example.net', async () => answer(both))
    expect(found.keys.map((key) => key.addresses[0])).toEqual(['sam@example.net'])
  })

  it('gives a key as a public key, whatever the server put in the file', async () => {
    const found = await lookupKey('sam@example.net', async () => answer(`${sam.publicKey}\n${sam.privateKey}`))
    expect(found.keys).toHaveLength(1)
    expect(found.keys[0].privateKey).toBeUndefined()
    expect(found.keys[0].locked).toBe(false)
  })

  it('says that nothing is published when the servers answered and have no key', async () => {
    const fetcher: Fetcher = async () => answer('no', false)
    await expect(lookupKey('sam@example.net', fetcher)).rejects.toMatchObject({ failure: 'notFound' })
  })

  it('says that no server could be reached when none answered', async () => {
    await expect(lookupKey('sam@example.net', web({ '*': 'down' }).fetcher)).rejects.toMatchObject({ failure: 'unreachable' })
  })

  it('says that it is not an address, and asks nobody', async () => {
    const t = web({ '*': answer('x') })
    await expect(lookupKey('nobody', t.fetcher)).rejects.toBeInstanceOf(KeyLookupError)
    expect(t.asked).toEqual([])
  })

  it('does not take what is empty or is too big to be a key', async () => {
    const empty: Fetcher = async () => answer(new Uint8Array(0))
    await expect(lookupKey('sam@example.net', empty)).rejects.toMatchObject({ failure: 'notFound' })
    const big: Fetcher = async () => answer(new Uint8Array(600 * 1024))
    await expect(lookupKey('sam@example.net', big)).rejects.toMatchObject({ failure: 'notFound' })
  })

  it('gives up on a server that does not answer in time, and asks the next', async () => {
    const fetcher: Fetcher = (url, init) =>
      url.includes('keys.openpgp.org')
        ? Promise.resolve(answer(sam.publicKey))
        : new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))
    const found = await lookupKey('sam@example.net', fetcher, 20)
    expect(found.source).toBe('keys.openpgp.org')
  })
})
