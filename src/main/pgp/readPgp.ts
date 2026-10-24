import type { SqlDb } from '../db/sqlDb'
import { simpleParser } from 'mailparser'
import type { MessageDetail, PgpStatus } from '@peregrine/core/types'
import {
  listAccountPrivateKeys,
  listContactPublicKeysByEmail
} from '../db/repositories/pgpKeysRepo'
import { getMessageRawSource } from '../db/repositories/messagesRepo'
import { listAttachments } from '../db/repositories/attachmentsRepo'
import { persistAttachments } from '../attachments/persist'
import {
  decryptAndVerify,
  PGP_MESSAGE_MARKER,
  verifyCleartextMessage,
  verifyDetachedSignature,
  type SignatureCheck
} from './pgpService'
import { isInlineCleartextSigned, parsePgpMime } from '@peregrine/core/pgpMimeParser'

/**
 * Turns a stored PGP message into something readable, on every read.
 *
 * Nothing is decrypted ahead of time and no plaintext is written back: the database keeps the
 * ciphertext, and a signature is re-checked each time rather than trusted from a stored
 * verdict. A verdict cached at sync time would say nothing about the message on screen.
 */

function signedStatus(check: SignatureCheck): PgpStatus {
  if (check === 'valid') return 'signed-verified'
  if (check === 'invalid') return 'signed-invalid'
  return 'signed-unverified'
}

/**
 * Every public key held for the sender, not just their current one.
 *
 * A signature can only be checked against the key that made it. If the sender has rotated
 * since, checking against the new key alone would report "signature invalid" for a message
 * that was perfectly good. A worse answer than admitting the key is unknown.
 */
async function senderKeys(db: SqlDb, detail: MessageDetail): Promise<string[]> {
  const address = detail.from[0]?.address
  return address ? listContactPublicKeysByEmail(db, address) : []
}

/** Reads the text and HTML out of a MIME entity that came out of a PGP envelope. */
async function bodiesFromEntity(
  db: SqlDb,
  accountId: string,
  detail: MessageDetail,
  entity: string
): Promise<{ textBody: string | null; htmlBody: string | null }> {
  const parsed = await simpleParser(entity)

  // Attachments inside the envelope only exist once it is opened; they are stored the first
  // time round so that opening and saving them works like it does for any other message.
  if (parsed.attachments.length > 0 && (await listAttachments(db, detail.id)).length === 0) {
    await persistAttachments(db, accountId, detail.id, parsed.attachments)
  }

  return { textBody: parsed.text ?? null, htmlBody: parsed.html || null }
}

async function readEncrypted(
  db: SqlDb,
  accountId: string,
  detail: MessageDetail,
  ciphertext: string
): Promise<MessageDetail> {
  const accountKeys = await listAccountPrivateKeys(db, accountId)
  if (accountKeys.length === 0) return { ...detail, pgpStatus: 'encrypted-failed' }

  const { plaintext, signatureValid } = await decryptAndVerify(
    ciphertext,
    accountKeys.map((key) => key.privateKeyArmored),
    await senderKeys(db, detail)
  )
  const bodies = await bodiesFromEntity(db, accountId, detail, plaintext)

  return {
    ...detail,
    ...bodies,
    attachments: await listAttachments(db, detail.id),
    pgpStatus: signatureValid === true ? 'encrypted-verified' : 'encrypted-unverified'
  }
}

async function readSigned(
  db: SqlDb,
  accountId: string,
  detail: MessageDetail,
  signedEntity: string,
  signature: string
): Promise<MessageDetail> {
  const check = await verifyDetachedSignature(signedEntity, signature, await senderKeys(db, detail))
  const bodies = await bodiesFromEntity(db, accountId, detail, signedEntity)

  return {
    ...detail,
    ...bodies,
    attachments: await listAttachments(db, detail.id),
    pgpStatus: signedStatus(check)
  }
}

/** The inline forms older clients still send; kept working alongside PGP/MIME. */
async function readInline(
  db: SqlDb,
  accountId: string,
  detail: MessageDetail
): Promise<MessageDetail> {
  if (isInlineCleartextSigned(detail.textBody)) {
    const { plaintext, signature } = await verifyCleartextMessage(
      detail.textBody as string,
      await senderKeys(db, detail)
    )
    return { ...detail, textBody: plaintext, htmlBody: null, pgpStatus: signedStatus(signature) }
  }

  if (!detail.textBody?.includes(PGP_MESSAGE_MARKER)) return detail

  const accountKeys = await listAccountPrivateKeys(db, accountId)
  if (accountKeys.length === 0) return detail

  const { plaintext, signatureValid } = await decryptAndVerify(
    detail.textBody,
    accountKeys.map((key) => key.privateKeyArmored),
    await senderKeys(db, detail)
  )
  return {
    ...detail,
    textBody: plaintext,
    htmlBody: null,
    pgpStatus: signatureValid === true ? 'encrypted-verified' : 'encrypted-unverified'
  }
}

export async function readPgpMessage(
  db: SqlDb,
  accountId: string,
  detail: MessageDetail
): Promise<MessageDetail> {
  try {
    const source = await getMessageRawSource(db, detail.id)
    if (source) {
      const pgp = parsePgpMime(source)
      if (pgp.kind === 'encrypted') {
        return await readEncrypted(db, accountId, detail, pgp.ciphertext)
      }
      if (pgp.kind === 'signed') {
        return await readSigned(db, accountId, detail, pgp.signedEntity, pgp.signature)
      }
    }
    return await readInline(db, accountId, detail)
  } catch (err) {
    // A message that cannot be decrypted still has to open. With its state stated plainly
    // rather than shown as if nothing had happened.
    console.error('PGP processing failed:', err instanceof Error ? err.message : err)
    return { ...detail, pgpStatus: 'encrypted-failed' }
  }
}
