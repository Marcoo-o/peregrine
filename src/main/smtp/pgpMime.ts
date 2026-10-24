import MimeNode from 'nodemailer/lib/mime-node'
import { buildRawMessage, type OutgoingMessage } from './messageBuilder'
import { splitHeadersAndBody } from '@peregrine/core/pgpMimeParser'

/**
 * Assembles outgoing PGP/MIME messages (RFC 3156).
 *
 * The payload is a complete MIME entity, which is why the inline form is not used any more:
 * inline PGP can only carry one blob of text, so HTML formatting and attachments were lost
 * the moment a message was encrypted.
 */

const CRLF = '\r\n'

/** Headers that describe the content, as opposed to the message that carries it. */
const CONTENT_HEADER = /^(content-|mime-version)/i

/**
 * Builds the inner entity: the content of the message with none of its addressing.
 *
 * From, To and Subject stay on the outside. They have to remain readable for the message to
 * be deliverable at all. Only the content is signed or encrypted, and that is what the
 * standard prescribes.
 */
export async function buildContentEntity(message: OutgoingMessage): Promise<string> {
  const raw = await buildRawMessage({
    ...message,
    from: '',
    to: [],
    cc: [],
    bcc: [],
    subject: '',
    inReplyTo: undefined,
    references: undefined
  })

  const { headers, body } = splitHeadersAndBody(raw.toString('utf8'))
  const kept = headers
    // Undo the folding first so a wrapped value cannot be torn apart by the filter.
    .replace(/\r\n[ \t]+/g, ' ')
    .split(CRLF)
    .filter((line) => CONTENT_HEADER.test(line))
  return `${kept.join(CRLF)}${CRLF}${CRLF}${body}`
}

interface Envelope {
  from: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  inReplyTo?: string
  references?: string
}

function applyEnvelope(node: MimeNode, envelope: Envelope): void {
  node.setHeader('From', envelope.from)
  if (envelope.to.length > 0) node.setHeader('To', envelope.to.join(', '))
  if (envelope.cc.length > 0) node.setHeader('Cc', envelope.cc.join(', '))
  if (envelope.bcc.length > 0) node.setHeader('Bcc', envelope.bcc.join(', '))
  node.setHeader('Subject', envelope.subject)
  if (envelope.inReplyTo) node.setHeader('In-Reply-To', envelope.inReplyTo)
  if (envelope.references) node.setHeader('References', envelope.references)
}

/**
 * multipart/encrypted: a version marker, then the ciphertext.
 *
 * The version part looks pointless but is required by the standard. It is what tells a
 * receiving client that the second part is OpenPGP and not some other encryption scheme.
 */
export async function buildEncryptedMessage(
  envelope: Envelope,
  ciphertext: string
): Promise<Buffer> {
  const root = new MimeNode('multipart/encrypted; protocol="application/pgp-encrypted"')
  applyEnvelope(root, envelope)

  const version = root.createChild('application/pgp-encrypted')
  version.setHeader('Content-Transfer-Encoding', '7bit')
  version.setHeader('Content-Description', 'PGP/MIME version identification')
  version.setContent(`Version: 1${CRLF}`)

  const payload = root.createChild('application/octet-stream; name="encrypted.asc"')
  payload.setHeader('Content-Transfer-Encoding', '7bit')
  payload.setHeader('Content-Description', 'OpenPGP encrypted message')
  payload.setHeader('Content-Disposition', 'inline; filename="encrypted.asc"')
  payload.setContent(ciphertext)

  return root.build()
}

/**
 * multipart/signed: the entity as it stands, followed by the detached signature.
 *
 * The first part is inserted verbatim rather than rebuilt, because the signature covers those
 * exact bytes. Letting the MIME builder re-encode it would invalidate the signature.
 */
export async function buildSignedMessage(
  envelope: Envelope,
  entity: string,
  armoredSignature: string
): Promise<Buffer> {
  const root = new MimeNode(
    'multipart/signed; micalg="pgp-sha256"; protocol="application/pgp-signature"'
  )
  applyEnvelope(root, envelope)

  // setRaw makes the node emit these bytes and nothing else. No headers of its own, no
  // re-encoding. That is the only way the signature still matches after assembly.
  root.createChild('').setRaw(entity)

  const signature = root.createChild('application/pgp-signature; name="signature.asc"')
  signature.setHeader('Content-Transfer-Encoding', '7bit')
  signature.setHeader('Content-Description', 'OpenPGP digital signature')
  signature.setContent(armoredSignature)

  return root.build()
}
