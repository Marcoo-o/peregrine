import { beforeAll, describe, expect, it } from 'vitest'
import * as openpgp from 'openpgp'

import {
  decryptMessage,
  encryptEntity,
  generateKeyPair,
  keyState,
  scanKeys,
  signEntity,
  unlockKey,
  verifyCleartext,
  verifyDetached,
  type KeyPair
} from './pgpService'

let alex: KeyPair
let sam: KeyPair
let stranger: KeyPair

beforeAll(async () => {
  alex = await generateKeyPair('Alex', 'alex@example.org')
  sam = await generateKeyPair('Sam', 'sam@example.net')
  stranger = await generateKeyPair('Eve', 'eve@attacker.test')
})

const ENTITY = 'Content-Type: text/plain; charset=utf-8\r\n\r\nMeet at noon'

describe('a new key pair', () => {
  it('has both halves, open, and a fingerprint', async () => {
    expect(alex.publicKey).toContain('BEGIN PGP PUBLIC KEY BLOCK')
    expect(alex.privateKey).toContain('BEGIN PGP PRIVATE KEY BLOCK')
    expect(alex.fingerprint).toMatch(/^[0-9a-f]{40}$/)
    expect((await openpgp.readPrivateKey({ armoredKey: alex.privateKey })).isDecrypted()).toBe(true)
  })

  it('says whose it is', async () => {
    const [scanned] = await scanKeys(alex.publicKey)
    expect(scanned.userIds).toEqual(['Alex <alex@example.org>'])
    expect(scanned.addresses).toEqual(['alex@example.org'])
  })
})

describe('encrypting', () => {
  it('can be read by a recipient, and by nobody else', async () => {
    const message = await encryptEntity(ENTITY, [sam.publicKey, alex.publicKey], alex.privateKey)
    expect(message).toContain('BEGIN PGP MESSAGE')
    expect((await decryptMessage(message, [sam.privateKey], [alex.publicKey])).text).toBe(ENTITY)
    expect((await decryptMessage(message, [alex.privateKey], [alex.publicKey])).text).toBe(ENTITY)
    await expect(decryptMessage(message, [stranger.privateKey], [])).rejects.toThrow()
  })

  it('says that the message was signed by the sender, when the sender key is known', async () => {
    const message = await encryptEntity(ENTITY, [sam.publicKey], alex.privateKey)
    expect((await decryptMessage(message, [sam.privateKey], [alex.publicKey])).signed).toBe(true)
  })

  it('says that a signature is not the sender’s when it was made by another key', async () => {
    const message = await encryptEntity(ENTITY, [sam.publicKey], stranger.privateKey)
    expect((await decryptMessage(message, [sam.privateKey], [alex.publicKey])).signed).toBe(false)
  })

  it('says nothing of a signature when no key of the sender is held, or when there is none', async () => {
    const signed = await encryptEntity(ENTITY, [sam.publicKey], alex.privateKey)
    expect((await decryptMessage(signed, [sam.privateKey], [])).signed).toBeNull()
    const unsigned = await encryptEntity(ENTITY, [sam.publicKey])
    expect((await decryptMessage(unsigned, [sam.privateKey], [alex.publicKey])).signed).toBeNull()
  })

  it('opens a message with whichever of the keys fits', async () => {
    const message = await encryptEntity(ENTITY, [sam.publicKey])
    expect((await decryptMessage(message, [stranger.privateKey, sam.privateKey], [])).text).toBe(ENTITY)
  })
})

describe('signing', () => {
  it('is checked against the entity it was made over', async () => {
    const signature = await signEntity(ENTITY, alex.privateKey)
    expect(await verifyDetached(ENTITY, signature, [alex.publicKey])).toBe('valid')
  })

  it('fails for an entity that was changed, even by one character', async () => {
    const signature = await signEntity(ENTITY, alex.privateKey)
    expect(await verifyDetached(ENTITY.replace('noon', 'nine'), signature, [alex.publicKey])).toBe('invalid')
  })

  it('fails for another key, and is unknown without one', async () => {
    const signature = await signEntity(ENTITY, alex.privateKey)
    expect(await verifyDetached(ENTITY, signature, [stranger.publicKey])).toBe('invalid')
    expect(await verifyDetached(ENTITY, signature, [])).toBe('unknown')
  })

  it('is valid when the right key is one of several held for the sender', async () => {
    const signature = await signEntity(ENTITY, alex.privateKey)
    expect(await verifyDetached(ENTITY, signature, [stranger.publicKey, alex.publicKey])).toBe('valid')
  })

  it('reads the inline form', async () => {
    const cleartext = (await openpgp.sign({
      message: await openpgp.createCleartextMessage({ text: 'Plain words' }),
      signingKeys: await openpgp.readPrivateKey({ armoredKey: alex.privateKey })
    })) as string
    expect(await verifyCleartext(cleartext, [alex.publicKey])).toEqual({ text: 'Plain words', signature: 'valid' })
    expect(await verifyCleartext(cleartext, [stranger.publicKey])).toEqual({ text: 'Plain words', signature: 'invalid' })
    expect(await verifyCleartext(cleartext, [])).toEqual({ text: 'Plain words', signature: 'unknown' })
  })
})

describe('reading a key file', () => {
  it('finds several keys in one text', async () => {
    const found = await scanKeys(`${alex.publicKey}\n${sam.publicKey}`)
    expect(found.map((key) => key.addresses[0])).toEqual(['alex@example.org', 'sam@example.net'])
    expect(found.every((key) => key.privateKey === undefined && !key.locked)).toBe(true)
  })

  it('reads the binary form', async () => {
    const binary = (await openpgp.readKey({ armoredKey: alex.publicKey })).write()
    const [found] = await scanKeys(binary)
    expect(found.fingerprint).toBe(alex.fingerprint)
  })

  it('makes one key of the public half and the private one, with the private half', async () => {
    const found = await scanKeys(`${alex.publicKey}\n${alex.privateKey}`)
    expect(found).toHaveLength(1)
    expect(found[0].privateKey).toContain('PRIVATE')
    expect(found[0].locked).toBe(false)
  })

  it('knows a private key that is sealed', async () => {
    const sealed = await sealedCopy(alex, 'correct horse')
    const [found] = await scanKeys(sealed)
    expect(found.locked).toBe(true)
    expect(found.publicKey).toContain('PUBLIC')
  })

  it('knows when a key stops being valid', async () => {
    const { publicKey } = await openpgp.generateKey({
      type: 'ecc',
      curve: 'curve25519Legacy',
      userIDs: [{ email: 'short@example.org' }],
      keyExpirationTime: 3600,
      format: 'armored'
    })
    const [found] = await scanKeys(publicKey)
    expect(found.expiresAt).toBeInstanceOf(Date)
    expect((await scanKeys(alex.publicKey))[0].expiresAt).toBeNull()
  })

  it('refuses text that is no key', async () => {
    await expect(scanKeys('not a key')).rejects.toThrow()
  })
})

async function sealedCopy(pair: KeyPair, passphrase: string): Promise<string> {
  const key = await openpgp.readPrivateKey({ armoredKey: pair.privateKey })
  return (await openpgp.encryptKey({ privateKey: key, passphrase })).armor()
}

describe('opening a sealed key', () => {
  it('gives the key open with the right passphrase', async () => {
    const result = await unlockKey(await sealedCopy(alex, 'correct horse'), 'correct horse')
    expect(result.ok).toBe(true)
    if (result.ok) expect((await openpgp.readPrivateKey({ armoredKey: result.privateKey })).isDecrypted()).toBe(true)
  })

  it('tells a wrong passphrase from none', async () => {
    const sealed = await sealedCopy(alex, 'correct horse')
    expect(await unlockKey(sealed, 'wrong')).toEqual({ ok: false, reason: 'wrongPassphrase' })
    expect(await unlockKey(sealed, '')).toEqual({ ok: false, reason: 'passphraseRequired' })
  })

  it('takes a key that is open as it is, whatever passphrase comes with it', async () => {
    const result = await unlockKey(alex.privateKey, '')
    expect(result.ok).toBe(true)
  })
})

/** A key that was made in the past, with a lifetime, so that it has expired by now or is about to. */
async function keyMadeAgo(daysAgo: number, lifetimeDays: number | undefined, address = 'old@example.org') {
  return openpgp.generateKey({
    type: 'ecc',
    curve: 'curve25519Legacy',
    userIDs: [{ email: address }],
    date: new Date(Date.now() - daysAgo * 86_400_000),
    keyExpirationTime: lifetimeDays === undefined ? undefined : lifetimeDays * 86_400,
    format: 'object'
  })
}

describe('the state of a key', () => {
  it('is good for encrypting and signing, and does not expire, for a key as it is made', async () => {
    expect(await keyState(alex.publicKey)).toEqual({ expiresAt: null, revoked: false, canEncrypt: true, canSign: true })
  })

  it('says when a key expires, and that it can be used until then', async () => {
    const { publicKey } = await keyMadeAgo(1, 30)
    const state = await keyState(publicKey.armor())
    expect(state.canEncrypt).toBe(true)
    expect(new Date(state.expiresAt as string).getTime()).toBeGreaterThan(Date.now())
  })

  it('is good for nothing once it has expired', async () => {
    const { publicKey } = await keyMadeAgo(10, 1)
    const state = await keyState(publicKey.armor())
    expect(state).toMatchObject({ revoked: false, canEncrypt: false, canSign: false })
    expect(new Date(state.expiresAt as string).getTime()).toBeLessThan(Date.now())
  })

  it('says that a key was withdrawn, and is good for nothing then either', async () => {
    const made = await keyMadeAgo(1, undefined)
    const { publicKey } = await openpgp.revokeKey({ key: made.privateKey, format: 'armored' })
    expect(await keyState(publicKey)).toMatchObject({ revoked: true, canEncrypt: false })
  })

  it('is good for nothing for what is no key', async () => {
    expect(await keyState('nonsense')).toEqual({ expiresAt: null, revoked: false, canEncrypt: false, canSign: false })
  })
})
