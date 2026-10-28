import { createHash } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import * as openpgp from 'openpgp'
import { installNativeS2k, type NativeS2k } from './nativeS2k'
import { generateKeyPair, unlockKey, useNativeS2k, verifyDetached, signEntity, type KeyPair } from './pgpService'

/** The platform's hashing as a program on a PC does it, byte by byte as the specification says, keeping what it was asked. */
function platform() {
  const calls: { algorithm: string; saltBytes: number; count: number }[] = []
  const hash: NativeS2k = {
    async iteratedS2k(algorithm, salt, passphrase, count) {
      calls.push({ algorithm, saltBytes: salt.length, count })
      const data = Buffer.concat([salt, passphrase])
      const total = Math.max(count, data.length)
      const bytes = Buffer.alloc(total)
      for (let i = 0; i < total; i++) bytes[i] = data[i % data.length]
      return new Uint8Array(createHash(algorithm).update(bytes).digest())
    }
  }
  return { hash, calls }
}

let alex: KeyPair

beforeAll(async () => {
  alex = await generateKeyPair('Alex', 'alex@example.org')
})

async function sealed(passphrase: string, config: openpgp.PartialConfig = {}): Promise<string> {
  const key = await openpgp.readPrivateKey({ armoredKey: alex.privateKey })
  return (await openpgp.encryptKey({ privateKey: key, passphrase, config })).armor()
}

describe('opening a sealed key with the hashing of the platform', () => {
  it('gives the same key as the script gives, and asks the platform for the hash of the primary key and of each subkey', async () => {
    const t = platform()
    useNativeS2k(t.hash)
    const result = await unlockKey(await sealed('correct horse'), 'correct horse')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The key that comes out is the key that went in, and it signs.
    expect((await openpgp.readPrivateKey({ armoredKey: result.privateKey })).isDecrypted()).toBe(true)
    expect(result.privateKey).toBe(alex.privateKey)
    const signature = await signEntity('entity', result.privateKey)
    expect(await verifyDetached('entity', signature, [alex.publicKey])).toBe('valid')
    expect(t.calls.length).toBe(2)
    expect(t.calls[0]).toEqual({ algorithm: 'sha256', saltBytes: 8, count: 16_777_216 })
  })

  it('says that a passphrase is wrong, as the script does, when the platform has hashed the wrong one', async () => {
    const t = platform()
    useNativeS2k(t.hash)
    expect(await unlockKey(await sealed('correct horse'), 'wrong')).toEqual({ ok: false, reason: 'wrongPassphrase' })
    expect(t.calls.length).toBeGreaterThan(0)
  })

  it('takes the count the key was sealed with, whatever it is', async () => {
    const t = platform()
    useNativeS2k(t.hash)
    const result = await unlockKey(await sealed('correct horse', { s2kIterationCountByte: 96 }), 'correct horse')
    expect(result.ok).toBe(true)
    expect(t.calls[0].count).toBe(65_536)
  })

  it('leaves a key that needs more bytes than one hash has to the script, which gives them', async () => {
    const t = platform()
    useNativeS2k(t.hash)
    const key = await openpgp.readPrivateKey({
      armoredKey: await sealed('correct horse', { s2kIterationCountByte: 96 })
    })
    installNativeS2k(key, t.hash)
    const s2k = (key as unknown as { keyPacket: { s2k: { produceKey(p: string, n: number, c: unknown): Promise<Uint8Array> } } }).keyPacket.s2k
    // 40 bytes are more than the 32 of the hash, so the specifier hashes twice, which is not done here.
    const long = await s2k.produceKey('correct horse', 40, openpgp.config)
    expect(long.length).toBe(40)
    expect(t.calls).toEqual([])
    // 32 are not.
    expect((await s2k.produceKey('correct horse', 32, openpgp.config)).length).toBe(32)
    expect(t.calls.length).toBe(1)
  })

  it('is not asked for a key that is not sealed', async () => {
    const t = platform()
    useNativeS2k(t.hash)
    expect((await unlockKey(alex.privateKey, '')).ok).toBe(true)
    expect(t.calls).toEqual([])
  })

  it('goes the way it went where the platform has none', async () => {
    useNativeS2k(undefined)
    const result = await unlockKey(await sealed('correct horse', { s2kIterationCountByte: 96 }), 'correct horse')
    expect(result.ok).toBe(true)
  })

  it('uses the platform that was given last', async () => {
    const first = platform()
    const second = platform()
    useNativeS2k(first.hash)
    await unlockKey(await sealed('correct horse', { s2kIterationCountByte: 96 }), 'correct horse')
    useNativeS2k(second.hash)
    await unlockKey(await sealed('correct horse', { s2kIterationCountByte: 96 }), 'correct horse')
    expect(second.calls.length).toBeGreaterThan(0)
  })
})
