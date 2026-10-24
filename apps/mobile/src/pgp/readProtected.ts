import { isInlineCleartextSigned, parsePgpMime, splitHeadersAndBody } from '@peregrine/core/pgpMimeParser'
import type { PgpStatus } from '@peregrine/core/types'
import type { SqlDb } from '@peregrine/core/sqlDb'
import { decodeAscii, decodeUtf8, encodeUtf8 } from '@peregrine/imap/utf8'
import { parseAddress } from '@peregrine/smtp/headers'
import type { Account } from '../accounts'
import type { ReadableMessage } from '../messageText'
import { addressKey, contactKeysFor, listOwnKeys } from './keyStore'
import { decryptMessage, verifyCleartext, verifyDetached, type SignatureCheck } from './pgpService'

/** What reading a message that may be signed or encrypted came to. */
export interface ProtectedReading {
  status: PgpStatus
  /** The message to read: the one that came, or for an encrypted one the same with its content opened. */
  source: Uint8Array
  /** For the inline forms, the text that was inside; the rest of the message is read from `source`. */
  text?: string
}

const CRLF = '\r\n'

/** How much of the start of a message is looked at for its type: the headers, which have no business being longer. */
const HEADER_BYTES = 16 * 1024

/** Whether the message is a PGP/MIME one by its top headers. Done without decoding the message, which can be large. */
function looksLikePgpMime(source: Uint8Array): boolean {
  const top = decodeAscii(source, 0, Math.min(source.length, HEADER_BYTES)).replace(/\r?\n[ \t]+/g, ' ')
  return /^content-type:\s*multipart\/(?:signed|encrypted)[^\r\n]*pgp/im.test(top)
}

const signedStatus = (check: SignatureCheck): PgpStatus =>
  check === 'valid' ? 'signed-verified' : check === 'invalid' ? 'signed-invalid' : 'signed-unverified'

/**
 * Every public key that may have made a signature on this message: those held for the sender, not only the newest, since
 * a sender who has changed keys since has signed older mail with the old one. The account's own keys count when the
 * message says it is from the account itself, which is what a copy in the Sent folder is.
 */
async function senderKeys(db: SqlDb, account: Account, sender: string): Promise<string[]> {
  const held = (await contactKeysFor(db, sender)).map((key) => key.publicKey)
  if (addressKey(sender) !== addressKey(account.emailAddress)) return held
  return [...held, ...(await listOwnKeys(db, account.id)).map((key) => key.publicKey)]
}

/**
 * The header lines of a message without the ones that describe its content, and without MIME-Version: the opened content
 * brings its own, and the two together are one message again. The line folding is kept.
 */
function outerHeaders(headers: string): string {
  const kept: string[] = []
  let describing = false
  for (const line of headers.split(CRLF)) {
    if (!/^[ \t]/.test(line)) describing = /^(content-|mime-version:)/i.test(line)
    if (!describing) kept.push(line)
  }
  return kept.join(CRLF)
}

/**
 * Reads what a message says of itself in OpenPGP: whether it is signed and whether the signature is the sender's, or
 * encrypted and whether it can be opened with a key of the account. Done at every reading and kept nowhere: a verdict that was
 * kept would say nothing about the message on the screen, and the opened content is not written to the database.
 *
 * It never throws. A message that cannot be opened is shown as it came, and said to be encrypted and not readable.
 */
export async function readProtected(
  db: SqlDb,
  account: Account,
  source: Uint8Array,
  readable: ReadableMessage
): Promise<ProtectedReading> {
  const unchanged: ProtectedReading = { status: 'none', source }
  try {
    const mime = looksLikePgpMime(source)
    if (!mime && !readable.text.includes('-----BEGIN PGP')) return unchanged
    const sender = parseAddress(readable.from).address
    const whole = mime ? decodeUtf8(source) : ''
    const pgp = mime ? parsePgpMime(whole) : { kind: 'none' as const }

    if (pgp.kind === 'signed') {
      const check = await verifyDetached(pgp.signedEntity, pgp.signature, await senderKeys(db, account, sender))
      return { status: signedStatus(check), source }
    }
    if (pgp.kind === 'encrypted') {
      const { text, signed } = await decryptMessage(pgp.ciphertext, await privateKeys(db, account), await senderKeys(db, account, sender))
      const { headers } = splitHeadersAndBody(whole)
      return {
        status: signed === true ? 'encrypted-verified' : 'encrypted-unverified',
        source: encodeUtf8(`${outerHeaders(headers)}${CRLF}MIME-Version: 1.0${CRLF}${text}`)
      }
    }
    if (isInlineCleartextSigned(readable.text)) {
      const { text, signature } = await verifyCleartext(readable.text, await senderKeys(db, account, sender))
      return { status: signedStatus(signature), source, text }
    }
    if (readable.text.includes('-----BEGIN PGP MESSAGE-----')) {
      const { text, signed } = await decryptMessage(readable.text, await privateKeys(db, account), await senderKeys(db, account, sender))
      return { status: signed === true ? 'encrypted-verified' : 'encrypted-unverified', source, text }
    }
    return unchanged
  } catch (error) {
    // A message that cannot be opened still has to open.
    console.warn(`reading the OpenPGP part of a message failed: ${error instanceof Error ? error.message : String(error)}`)
    return { status: 'encrypted-failed', source }
  }
}

async function privateKeys(db: SqlDb, account: Account): Promise<string[]> {
  const keys = await listOwnKeys(db, account.id)
  if (keys.length === 0) throw new Error('Das Konto hat keinen Schlüssel')
  return keys.map((key) => key.privateKey)
}
