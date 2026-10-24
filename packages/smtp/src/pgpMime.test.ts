import { describe, expect, it } from 'vitest'
import { parsePgpMime } from '@peregrine/core/pgpMimeParser'
import { composeProtected } from './compose'
import { encryptedBody, signedBody } from './pgpMime'

const SIGNATURE = '-----BEGIN PGP SIGNATURE-----\n\nabcd\n=wxyz\n-----END PGP SIGNATURE-----\n'
const MESSAGE = '-----BEGIN PGP MESSAGE-----\n\nabcd\n=wxyz\n-----END PGP MESSAGE-----\n'
const input = { from: 'alex@example.org', to: ['sam@example.net'], subject: 'Hello', text: 'Secret café' }
const options = { now: new Date('2026-10-24T10:00:00Z'), random: () => 0.5 }

const text = (source: Uint8Array): string => new TextDecoder().decode(source)

describe('composeProtected', () => {
  it('hands the content over as an entity of its own, without addressing and without a line end at its end', async () => {
    let seen = ''
    await composeProtected(input, options, async (entity) => {
      seen = entity.source
      return signedBody(entity, SIGNATURE, options.random)
    })
    expect(seen).toMatch(/^Content-Type: text\/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nSecret caf=C3=A9$/)
    expect(seen).not.toMatch(/Subject|From|To:/)
  })

  it('keeps the addressing outside, readable', async () => {
    const composed = await composeProtected(input, options, async (entity) => encryptedBody(MESSAGE, options.random))
    const source = text(composed.source)
    expect(source).toMatch(/^From: <?alex@example\.org>?/m)
    expect(source).toMatch(/^Subject: Hello$/m)
    expect(source).not.toContain('Secret')
    expect(composed.envelope.to).toEqual(['sam@example.net'])
  })
})

describe('signedBody', () => {
  it('is read back as the entity that was signed, byte for byte, and the signature', async () => {
    let entityText = ''
    const composed = await composeProtected(input, options, async (entity) => {
      entityText = entity.source
      return signedBody(entity, SIGNATURE, options.random)
    })
    const parsed = parsePgpMime(text(composed.source))
    expect(parsed.kind).toBe('signed')
    if (parsed.kind !== 'signed') return
    expect(parsed.signedEntity).toBe(entityText)
    expect(parsed.signature).toBe(SIGNATURE.trim().replace(/\n/g, '\r\n'))
  })

  it('says the hash of the signature in the micalg parameter', async () => {
    const composed = await composeProtected(input, options, async (entity) => signedBody(entity, SIGNATURE, options.random))
    expect(text(composed.source)).toContain('micalg="pgp-sha256"')
  })
})

describe('encryptedBody', () => {
  it('is read back as the ciphertext, with CR LF line ends', async () => {
    const composed = await composeProtected(input, options, async () => encryptedBody(MESSAGE, options.random))
    const parsed = parsePgpMime(text(composed.source))
    expect(parsed).toEqual({ kind: 'encrypted', ciphertext: MESSAGE.trim().replace(/\n/g, '\r\n') })
  })

  it('has only lines a message may have', async () => {
    const composed = await composeProtected(input, options, async () => encryptedBody(MESSAGE, options.random))
    expect(text(composed.source)).not.toMatch(/[^\r]\n/)
  })
})
