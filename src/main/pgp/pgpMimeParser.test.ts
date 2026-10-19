import { describe, expect, it } from 'vitest'
import {
  contentTypeParameter,
  headerValue,
  isInlineCleartextSigned,
  parsePgpMime,
  splitHeadersAndBody,
  splitMimeParts
} from './pgpMimeParser'

const CRLF = '\r\n'
const lines = (...parts: string[]): string => parts.join(CRLF)

describe('splitHeadersAndBody', () => {
  it('splits at the first empty line', () => {
    const source = lines('Subject: Test', 'X-Other: 1', '', 'Hallo', '')
    expect(splitHeadersAndBody(source)).toEqual({
      headers: lines('Subject: Test', 'X-Other: 1'),
      body: lines('Hallo', '')
    })
  })

  it('treats a message without a body as all headers', () => {
    expect(splitHeadersAndBody('Subject: Test').body).toBe('')
  })

  it('keeps empty lines inside the body', () => {
    expect(splitHeadersAndBody(lines('A: 1', '', 'x', '', 'y')).body).toBe(lines('x', '', 'y'))
  })
})

describe('headerValue', () => {
  it('finds a header regardless of case', () => {
    expect(headerValue('Content-Type: text/plain', 'CONTENT-TYPE')).toBe('text/plain')
  })

  it('unfolds values wrapped across lines', () => {
    const headers = lines('Content-Type: multipart/signed;', '\tprotocol="application/pgp-signature"')
    expect(headerValue(headers, 'Content-Type')).toBe(
      'multipart/signed; protocol="application/pgp-signature"'
    )
  })

  it('returns null for a header that is not there', () => {
    expect(headerValue('Subject: x', 'Content-Type')).toBeNull()
  })
})

describe('contentTypeParameter', () => {
  it('reads a quoted parameter', () => {
    expect(contentTypeParameter('multipart/signed; boundary="a=b;c"', 'boundary')).toBe('a=b;c')
  })

  it('reads an unquoted parameter', () => {
    expect(contentTypeParameter('multipart/mixed; boundary=abc123', 'boundary')).toBe('abc123')
  })

  it('does not mistake one parameter for another with the same suffix', () => {
    expect(contentTypeParameter('x; micalg="pgp-sha256"; alg="no"', 'alg')).toBe('no')
  })
})

describe('splitMimeParts', () => {
  it('returns the parts without the delimiter lines', () => {
    const body = lines('--BB', 'A: 1', '', 'erster', '--BB', 'B: 2', '', 'zweiter', '--BB--', '')
    expect(splitMimeParts(body, 'BB')).toEqual([
      lines('A: 1', '', 'erster'),
      lines('B: 2', '', 'zweiter')
    ])
  })

  it('does not swallow the last part into the closing delimiter', () => {
    const body = lines('--BB', '', 'eins', '--BB', '', 'zwei', '--BB--', '')
    expect(splitMimeParts(body, 'BB')).toHaveLength(2)
  })

  // The CRLF in front of a delimiter belongs to the delimiter. Attaching it to the part
  // instead adds a byte to the signed entity and every signature check fails.
  it('leaves no trailing newline on a part', () => {
    const body = lines('--BB', '', 'inhalt', '--BB', '', 'sig', '--BB--', '')
    expect(splitMimeParts(body, 'BB')[0]).toBe(lines('', 'inhalt'))
  })

  it('preserves a blank line that is really part of the content', () => {
    const body = lines('--BB', '', 'inhalt', '', '--BB', '', 'sig', '--BB--', '')
    expect(splitMimeParts(body, 'BB')[0]).toBe(lines('', 'inhalt', ''))
  })
})

const SIGNED_MESSAGE = lines(
  'From: a@example.com',
  'Content-Type: multipart/signed; micalg="pgp-sha256";',
  ' protocol="application/pgp-signature"; boundary="SIG"',
  '',
  '--SIG',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Hallo Welt',
  '--SIG',
  'Content-Type: application/pgp-signature; name="signature.asc"',
  '',
  '-----BEGIN PGP SIGNATURE-----',
  '',
  'abc',
  '-----END PGP SIGNATURE-----',
  '--SIG--',
  ''
)

const ENCRYPTED_MESSAGE = lines(
  'From: a@example.com',
  'Content-Type: multipart/encrypted; protocol="application/pgp-encrypted"; boundary="ENC"',
  '',
  '--ENC',
  'Content-Type: application/pgp-encrypted',
  '',
  'Version: 1',
  '--ENC',
  'Content-Type: application/octet-stream',
  '',
  '-----BEGIN PGP MESSAGE-----',
  '',
  'xyz',
  '-----END PGP MESSAGE-----',
  '--ENC--',
  ''
)

describe('parsePgpMime', () => {
  it('returns the signed entity byte for byte', () => {
    const result = parsePgpMime(SIGNED_MESSAGE)
    expect(result.kind).toBe('signed')
    if (result.kind !== 'signed') return
    expect(result.signedEntity).toBe(
      lines('Content-Type: text/plain; charset=utf-8', '', 'Hallo Welt')
    )
    expect(result.signature).toContain('BEGIN PGP SIGNATURE')
  })

  it('returns the ciphertext of an encrypted message', () => {
    const result = parsePgpMime(ENCRYPTED_MESSAGE)
    expect(result.kind).toBe('encrypted')
    if (result.kind !== 'encrypted') return
    expect(result.ciphertext.startsWith('-----BEGIN PGP MESSAGE-----')).toBe(true)
    expect(result.ciphertext.endsWith('-----END PGP MESSAGE-----')).toBe(true)
  })

  it('ignores a plain message', () => {
    expect(parsePgpMime(lines('Content-Type: text/plain', '', 'Hallo')).kind).toBe('none')
  })

  it('ignores multipart/signed that is not signed with PGP', () => {
    const smime = SIGNED_MESSAGE.replace(
      'protocol="application/pgp-signature"',
      'protocol="application/pkcs7-signature"'
    )
    expect(parsePgpMime(smime).kind).toBe('none')
  })

  it('ignores an encrypted shape whose second part holds no PGP message', () => {
    expect(parsePgpMime(ENCRYPTED_MESSAGE.replace('BEGIN PGP MESSAGE', 'BEGIN SOMETHING')).kind).toBe(
      'none'
    )
  })
})

describe('isInlineCleartextSigned', () => {
  it('recognises the inline form older clients still send', () => {
    expect(isInlineCleartextSigned('-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA256')).toBe(true)
  })

  it('says no for an empty body', () => {
    expect(isInlineCleartextSigned(null)).toBe(false)
  })
})
