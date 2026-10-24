import { beforeAll, describe, expect, it } from 'vitest'
import { simpleParser } from 'mailparser'
import {
  decryptAndVerify,
  encryptMimeEntity,
  generateKeyPair,
  signMimeEntity,
  verifyDetachedSignature,
  type GeneratedKeyPair
} from '../pgp/pgpService'
import { parsePgpMime } from '@peregrine/core/pgpMimeParser'
import { buildContentEntity, buildEncryptedMessage, buildSignedMessage } from './pgpMime'
import type { OutgoingMessage } from './messageBuilder'

/**
 * Round trip against real OpenPGP operations rather than a stub.
 *
 * What has to hold is that a message this app assembles can be taken apart and verified
 * again afterwards. And that is exactly what a mocked crypto layer would never catch, since
 * the whole risk sits in the bytes between building and parsing.
 */

const message: OutgoingMessage = {
  from: '"Anna Meier" <anna@example.com>',
  to: ['"Bert Groß" <bert@example.com>'],
  cc: [],
  bcc: [],
  subject: 'Rechnung für März',
  text: 'Hallo Bert,\n\nanbei die Rechnung.\n\nGrüße, Anna',
  html: '<p>Hallo Bert,</p><p>anbei die <b>Rechnung</b>.</p>',
  attachments: []
}

const envelope = {
  from: message.from,
  to: message.to,
  cc: message.cc,
  bcc: message.bcc,
  subject: message.subject
}

let keys: GeneratedKeyPair
let strangerKeys: GeneratedKeyPair

beforeAll(async () => {
  keys = await generateKeyPair('Anna Meier', 'anna@example.com')
  strangerKeys = await generateKeyPair('Mallory', 'mallory@example.com')
}, 30_000)

describe('buildContentEntity', () => {
  it('keeps the content headers and drops the addressing', async () => {
    const entity = await buildContentEntity(message)
    expect(entity).toMatch(/^Content-Type: multipart\/alternative;/m)
    expect(entity).toMatch(/^MIME-Version: 1\.0$/m)
    expect(entity).not.toMatch(/^Subject:/m)
    expect(entity).not.toMatch(/^To:/m)
    expect(entity).not.toMatch(/^From:/m)
  })

  it('keeps both alternatives, which the inline form could not', async () => {
    const entity = await buildContentEntity(message)
    const parsed = await simpleParser(entity)
    expect(parsed.text?.trim()).toContain('anbei die Rechnung.')
    expect(parsed.html).toContain('<b>Rechnung</b>')
  })
})

describe('signed messages', () => {
  it('survives assembly and verifies against the sender key', async () => {
    const entity = await buildContentEntity(message)
    const signature = await signMimeEntity(entity, keys.privateKeyArmored)
    const raw = (await buildSignedMessage(envelope, entity, signature)).toString('utf8')

    const parsed = parsePgpMime(raw)
    expect(parsed.kind).toBe('signed')
    if (parsed.kind !== 'signed') return

    // The entity has to come back out byte for byte; one added newline breaks the signature.
    expect(parsed.signedEntity).toBe(entity)
    await expect(
      verifyDetachedSignature(parsed.signedEntity, parsed.signature, [keys.publicKeyArmored])
    ).resolves.toBe('valid')
  })

  it('keeps subject and recipient readable on the outside', async () => {
    const entity = await buildContentEntity(message)
    const signature = await signMimeEntity(entity, keys.privateKeyArmored)
    const raw = (await buildSignedMessage(envelope, entity, signature)).toString('utf8')

    const parsed = await simpleParser(raw)
    expect(parsed.subject).toBe('Rechnung für März')
    expect(raw).toContain('multipart/signed')
  })

  it('reports a tampered message as invalid', async () => {
    const entity = await buildContentEntity(message)
    const signature = await signMimeEntity(entity, keys.privateKeyArmored)
    const raw = (await buildSignedMessage(envelope, entity, signature))
      .toString('utf8')
      .replace('Rechnung.', 'Mahnung.')

    const parsed = parsePgpMime(raw)
    expect(parsed.kind).toBe('signed')
    if (parsed.kind !== 'signed') return
    await expect(
      verifyDetachedSignature(parsed.signedEntity, parsed.signature, [keys.publicKeyArmored])
    ).resolves.toBe('invalid')
  })

  it('reports a signature by someone else as invalid, not as valid', async () => {
    const entity = await buildContentEntity(message)
    const signature = await signMimeEntity(entity, strangerKeys.privateKeyArmored)
    await expect(
      verifyDetachedSignature(entity, signature, [keys.publicKeyArmored])
    ).resolves.toBe('invalid')
  })

  it('says unknown - not valid - when the sender key is missing', async () => {
    const entity = await buildContentEntity(message)
    const signature = await signMimeEntity(entity, keys.privateKeyArmored)
    await expect(verifyDetachedSignature(entity, signature, [])).resolves.toBe('unknown')
  })
})

describe('encrypted messages', () => {
  it('round trips through the multipart/encrypted envelope', async () => {
    const entity = await buildContentEntity(message)
    const ciphertext = await encryptMimeEntity(
      entity,
      [keys.publicKeyArmored],
      keys.privateKeyArmored
    )
    const raw = (await buildEncryptedMessage(envelope, ciphertext)).toString('utf8')

    const parsed = parsePgpMime(raw)
    expect(parsed.kind).toBe('encrypted')
    if (parsed.kind !== 'encrypted') return

    const { plaintext, signatureValid } = await decryptAndVerify(
      parsed.ciphertext,
      [keys.privateKeyArmored],
      [keys.publicKeyArmored]
    )
    expect(signatureValid).toBe(true)

    // The point of PGP/MIME: HTML and the plain-text alternative both come back.
    const inner = await simpleParser(plaintext)
    expect(inner.text?.trim()).toContain('anbei die Rechnung.')
    expect(inner.html).toContain('<b>Rechnung</b>')
  }, 20_000)

  it('does not leave the body readable in the sent message', async () => {
    const entity = await buildContentEntity(message)
    const ciphertext = await encryptMimeEntity(entity, [keys.publicKeyArmored], null)
    const raw = (await buildEncryptedMessage(envelope, ciphertext)).toString('utf8')

    expect(raw).not.toContain('anbei die Rechnung')
    expect(raw).toContain('-----BEGIN PGP MESSAGE-----')
  }, 20_000)
})

/**
 * Rotating a key must not cost the past.
 *
 * `keys` stands for the old key here and `rotatedKeys` for the new one. The situation after
 * a rotation, where the ring holds both and the newer one is the active half.
 */
describe('a ring of several keys', () => {
  let rotatedKeys: GeneratedKeyPair

  beforeAll(async () => {
    rotatedKeys = await generateKeyPair('Anna Neu', 'anna@example.com')
  }, 30_000)

  it('still opens mail encrypted to the retired key', async () => {
    const entity = await buildContentEntity(message)
    // Encrypted back when the old key was the current one.
    const ciphertext = await encryptMimeEntity(entity, [keys.publicKeyArmored], null)

    const { plaintext } = await decryptAndVerify(
      ciphertext,
      [rotatedKeys.privateKeyArmored, keys.privateKeyArmored],
      []
    )
    expect(plaintext).toContain('anbei die Rechnung.')
  }, 20_000)

  it('reports the archive as unreadable once the old key is gone', async () => {
    const entity = await buildContentEntity(message)
    const ciphertext = await encryptMimeEntity(entity, [keys.publicKeyArmored], null)

    // The very loss this keyring exists to prevent. Here on purpose, to show it is real.
    await expect(
      decryptAndVerify(ciphertext, [rotatedKeys.privateKeyArmored], [])
    ).rejects.toThrow()
  }, 20_000)

  it('still verifies a signature made with the retired key', async () => {
    const entity = await buildContentEntity(message)
    const signature = await signMimeEntity(entity, keys.privateKeyArmored)

    await expect(
      verifyDetachedSignature(entity, signature, [
        rotatedKeys.publicKeyArmored,
        keys.publicKeyArmored
      ])
    ).resolves.toBe('valid')
  }, 20_000)

  // The risk of accepting a list: that one of the keys matching is read as "good enough".
  it('does not turn a stranger’s signature valid by offering more keys', async () => {
    const entity = await buildContentEntity(message)
    const signature = await signMimeEntity(entity, strangerKeys.privateKeyArmored)

    await expect(
      verifyDetachedSignature(entity, signature, [
        keys.publicKeyArmored,
        rotatedKeys.publicKeyArmored
      ])
    ).resolves.toBe('invalid')
  }, 20_000)

  it('decrypts with a retired key while checking the signature against the sender’s new one', async () => {
    const entity = await buildContentEntity(message)
    const ciphertext = await encryptMimeEntity(
      entity,
      [keys.publicKeyArmored],
      strangerKeys.privateKeyArmored
    )

    const { plaintext, signatureValid } = await decryptAndVerify(
      ciphertext,
      [rotatedKeys.privateKeyArmored, keys.privateKeyArmored],
      [keys.publicKeyArmored, strangerKeys.publicKeyArmored]
    )
    expect(plaintext).toContain('anbei die Rechnung.')
    expect(signatureValid).toBe(true)
  }, 20_000)
})
