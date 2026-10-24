import { unique, type ContentEntity, type MessageBody } from './compose'

const CRLF = '\r\n'

/** An armored block as a message carries it: with the line ends of a message, whatever the armor was written with. */
const crlf = (armored: string): string => armored.trim().replace(/\r?\n/g, CRLF)

/**
 * The body of a message whose content is signed, RFC 3156: the content as it is, and the detached signature that was made
 * over it. The first part is the entity itself, byte for byte, since the signature covers those bytes and not what a
 * message builder would make of them.
 */
export function signedBody(entity: ContentEntity, armoredSignature: string, random: () => number = Math.random): MessageBody {
  const boundary = unique(random, [entity.source, armoredSignature])
  return {
    headers: [`Content-Type: multipart/signed; micalg="pgp-sha256"; protocol="application/pgp-signature"; boundary="${boundary}"`],
    text:
      `--${boundary}${CRLF}${entity.source}${CRLF}` +
      `--${boundary}${CRLF}` +
      `Content-Type: application/pgp-signature; name="signature.asc"${CRLF}` +
      `Content-Description: OpenPGP digital signature${CRLF}` +
      `Content-Transfer-Encoding: 7bit${CRLF}${CRLF}` +
      `${crlf(armoredSignature)}${CRLF}` +
      `--${boundary}--${CRLF}`
  }
}

/**
 * The body of a message whose content is encrypted, RFC 3156: a part that says the second one is OpenPGP, which a reader
 * needs to know it, and the ciphertext.
 */
export function encryptedBody(armoredMessage: string, random: () => number = Math.random): MessageBody {
  const boundary = unique(random, [armoredMessage])
  return {
    headers: [`Content-Type: multipart/encrypted; protocol="application/pgp-encrypted"; boundary="${boundary}"`],
    text:
      `--${boundary}${CRLF}` +
      `Content-Type: application/pgp-encrypted${CRLF}` +
      `Content-Description: PGP/MIME version identification${CRLF}` +
      `Content-Transfer-Encoding: 7bit${CRLF}${CRLF}` +
      `Version: 1${CRLF}${CRLF}` +
      `--${boundary}${CRLF}` +
      `Content-Type: application/octet-stream; name="encrypted.asc"${CRLF}` +
      `Content-Description: OpenPGP encrypted message${CRLF}` +
      `Content-Disposition: inline; filename="encrypted.asc"${CRLF}` +
      `Content-Transfer-Encoding: 7bit${CRLF}${CRLF}` +
      `${crlf(armoredMessage)}${CRLF}` +
      `--${boundary}--${CRLF}`
  }
}
