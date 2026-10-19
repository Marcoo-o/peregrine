/**
 * Splits PGP/MIME messages (RFC 3156) apart.
 *
 * This works on the raw message source rather than on a parsed representation because a
 * detached signature is computed over the signed MIME entity byte for byte, headers included.
 * Any parser that normalises whitespace, re-folds headers or re-encodes the body destroys
 * exactly the bytes the signature was made over, so the split has to happen here.
 */

const CRLF = '\r\n'

export interface PgpMimeEncrypted {
  kind: 'encrypted'
  /** The armored OpenPGP message; decrypting it yields another complete MIME entity. */
  ciphertext: string
}

export interface PgpMimeSigned {
  kind: 'signed'
  /** The signed entity exactly as transmitted. Headers, blank line and body. */
  signedEntity: string
  signature: string
}

export type PgpMimePart = PgpMimeEncrypted | PgpMimeSigned | { kind: 'none' }

/** Header block and body of a MIME entity, split at the first empty line. */
export function splitHeadersAndBody(source: string): { headers: string; body: string } {
  const separator = source.indexOf(CRLF + CRLF)
  if (separator === -1) return { headers: source, body: '' }
  return {
    headers: source.slice(0, separator),
    body: source.slice(separator + 2 * CRLF.length)
  }
}

/** Reads one header, undoing the line folding that long values are wrapped with. */
export function headerValue(headers: string, name: string): string | null {
  const unfolded = headers.replace(/\r\n[ \t]+/g, ' ')
  for (const line of unfolded.split(CRLF)) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    if (line.slice(0, colon).trim().toLowerCase() === name.toLowerCase()) {
      return line.slice(colon + 1).trim()
    }
  }
  return null
}

/** Reads a Content-Type parameter, with or without quotes around the value. */
export function contentTypeParameter(contentType: string, parameter: string): string | null {
  const match = new RegExp(`;\\s*${parameter}\\s*=\\s*("([^"]*)"|[^;\\s]+)`, 'i').exec(contentType)
  if (!match) return null
  return match[2] ?? match[1]
}

/**
 * Returns the parts between the boundary delimiters, verbatim.
 *
 * The CRLF in front of a delimiter line belongs to the delimiter, not to the part before it.
 * Getting that wrong adds a trailing newline to the signed entity and every signature fails.
 */
export function splitMimeParts(body: string, boundary: string): string[] {
  const delimiter = `${CRLF}--${boundary}`
  // The first delimiter may open the body without a preceding CRLF.
  const normalized = body.startsWith(`--${boundary}`) ? CRLF + body : body

  const parts: string[] = []
  let cursor = normalized.indexOf(delimiter)
  while (cursor !== -1) {
    const afterDelimiter = cursor + delimiter.length
    if (normalized.startsWith('--', afterDelimiter)) break // closing delimiter
    const start = normalized.indexOf(CRLF, afterDelimiter)
    if (start === -1) break
    const next = normalized.indexOf(delimiter, start)
    if (next === -1) break
    parts.push(normalized.slice(start + CRLF.length, next))
    cursor = next
  }
  return parts
}

/** Recognises the two PGP/MIME shapes; anything else is reported as `none`. */
export function parsePgpMime(source: string): PgpMimePart {
  const { headers, body } = splitHeadersAndBody(source)
  const contentType = headerValue(headers, 'Content-Type')
  if (!contentType) return { kind: 'none' }

  const type = contentType.split(';')[0].trim().toLowerCase()
  const protocol = contentTypeParameter(contentType, 'protocol')?.toLowerCase()
  const boundary = contentTypeParameter(contentType, 'boundary')
  if (!boundary) return { kind: 'none' }

  if (type === 'multipart/encrypted' && protocol === 'application/pgp-encrypted') {
    const parts = splitMimeParts(body, boundary)
    // Part 1 is the version marker, part 2 carries the ciphertext.
    if (parts.length < 2) return { kind: 'none' }
    const ciphertext = splitHeadersAndBody(parts[1]).body.trim()
    if (!ciphertext.startsWith('-----BEGIN PGP MESSAGE-----')) return { kind: 'none' }
    return { kind: 'encrypted', ciphertext }
  }

  if (type === 'multipart/signed' && protocol === 'application/pgp-signature') {
    const parts = splitMimeParts(body, boundary)
    if (parts.length < 2) return { kind: 'none' }
    const signature = splitHeadersAndBody(parts[1]).body.trim()
    if (!signature.startsWith('-----BEGIN PGP SIGNATURE-----')) return { kind: 'none' }
    return { kind: 'signed', signedEntity: parts[0], signature }
  }

  return { kind: 'none' }
}

const CLEARTEXT_MARKER = '-----BEGIN PGP SIGNED MESSAGE-----'

/** Older clients sign inline instead of as PGP/MIME; those messages stay readable. */
export function isInlineCleartextSigned(body: string | null): boolean {
  return body != null && body.includes(CLEARTEXT_MARKER)
}
