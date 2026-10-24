import type { ImapSession } from '@peregrine/core/imapSession'
import { safeFilename } from '@peregrine/core/safeFilename'
import type { SecureMode, ComposeInput } from '@peregrine/core/types'
import type { SqlDb } from '@peregrine/core/sqlDb'
import type { Transport } from '@peregrine/imap/transport'
import { SmtpClient, type SendResult } from '@peregrine/smtp/client'
import { composeMessage, type Attachment, type ComposeInput as SmtpInput, type ComposeOptions } from '@peregrine/smtp/compose'
import { getAccount, type Account } from './accounts'
import { MAX_ATTACHMENT_BYTES, type FileAccess } from './files'
import { getFolderBySpecialUse } from './folders'
import { contentTypeFor } from './mimeTypes'
import { composeProtectedMessage } from './pgp/protect'

/** What sending needs of the device: a way to connect, and the files that were attached. */
export interface SendEnvironment {
  makeTransport: () => Transport
  /** Without it a message with attachments cannot be sent, and is refused with the reason. */
  files?: FileAccess
}

/** Reads the copies of the attached files. They stay where they are: removing them is for after the sending. */
async function readAttachments(input: ComposeInput, files: FileAccess | undefined): Promise<Attachment[]> {
  if (input.attachments.length === 0) return []
  if (!files) throw new Error('This build cannot read the files that were attached')
  const attachments: Attachment[] = []
  let total = 0
  for (const attached of input.attachments) {
    const content = await files.read(attached.path)
    total += content.length
    if (total > MAX_ATTACHMENT_BYTES) throw new Error('The attachments are larger than one message can carry')
    attachments.push({
      filename: safeFilename(attached.filename, `anhang-${attachments.length + 1}`),
      contentType: attached.contentType ?? contentTypeFor(attached.filename),
      content
    })
  }
  return attachments
}

/** Where and how an account sends. What the form leaves out is the usual for the kind of connection. */
export interface SmtpSettings {
  host: string
  port: number
  secure: SecureMode
  username: string
  password: string
}

/**
 * The settings for sending, or undefined when the account has no server for it.
 *
 * Most providers want the same login for both, so a user name or a password that was not given for
 * sending is the one for reading. A port that was not given is the one that goes with the kind of
 * connection, 465 for TLS from the start and 587 for STARTTLS.
 */
export function smtpSettingsOf(account: Account): SmtpSettings | undefined {
  if (!account.smtpHost) return undefined
  const secure = account.smtpSecure ?? 'starttls'
  return {
    host: account.smtpHost,
    port: account.smtpPort ?? (secure === 'tls' ? 465 : 587),
    secure,
    username: account.smtpUsername ?? account.imapUsername,
    password: account.smtpPassword ?? account.password
  }
}

/** What the message is made of, from what the account and the input say; the addressing and the content, before they are signed or encrypted. */
async function smtpInputOf(account: Account, input: ComposeInput, files: FileAccess | undefined): Promise<SmtpInput> {
  return {
    // A name that is only the address again says nothing, and shows twice in a mail client.
    from: { name: account.displayName === account.emailAddress ? undefined : account.displayName, address: account.emailAddress },
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    text: input.textBody,
    html: input.htmlBody === '' ? undefined : input.htmlBody,
    attachments: await readAttachments(input, files),
    inReplyTo: input.inReplyTo,
    references: input.references
  }
}

/**
 * The message that an input says, written out from an account: what is sent, and what a draft keeps. The account
 * must have an address, which the callers have looked at. When the input asks for it the content is signed or
 * encrypted, with the keys the database holds, and raises the reason when that cannot be done: a message that was
 * asked to be encrypted is never written in the clear.
 */
export async function composeFromInput(
  db: SqlDb,
  account: Account,
  input: ComposeInput,
  files: FileAccess | undefined,
  options: ComposeOptions = {}
): Promise<ReturnType<typeof composeMessage>> {
  const message = await smtpInputOf(account, input, files)
  const protection = { encrypt: input.encrypt === true, sign: input.sign === true }
  if (!protection.encrypt && !protection.sign) return composeMessage(message, options)
  return composeProtectedMessage(db, account.id, protection, message, options)
}

/**
 * Sends one message from the application and says who it went to, with the source that went out.
 * Throws, with the reason, when it did not: the queue keeps a message whose sending threw and tries
 * it again.
 *
 * It refuses what the phone cannot do yet, and says so, where the alternative is sending something
 * other than what was written: one for a later time would go out now.
 */
export async function sendMessage(
  db: SqlDb,
  environment: SendEnvironment,
  input: ComposeInput,
  options: ComposeOptions = {}
): Promise<SentMessage> {
  const account = await getAccount(db, input.accountId)
  if (!account) throw new Error('The account this message was written for is gone')
  if (input.sendAt !== undefined && input.sendAt > Date.now()) {
    throw new Error('Sending at a later time is not on the phone yet')
  }
  if (!account.emailAddress) throw new Error('This account has no address to send from')
  const settings = smtpSettingsOf(account)
  if (!settings) throw new Error('This account has no server for sending')

  const composed = await composeFromInput(db, account, input, environment.files, options)

  const client = new SmtpClient(environment.makeTransport(), settings)
  try {
    await client.connect()
    const result = await client.send({ from: composed.envelope.from, to: composed.envelope.to, data: composed.source })
    return { result, source: composed.source }
  } finally {
    await client.close()
  }
}

export interface SentMessage {
  result: SendResult
  /** The message as it went out, which is what the copy for the Sent folder is made of. */
  source: Uint8Array
}

/**
 * Sends a message and files a copy of it in the account's Sent folder, as a mail client does and as
 * most providers do not do themselves.
 *
 * The copy is made after the server has accepted the message, and nothing that goes wrong with it
 * fails the send. The queue would take that for a message that did not go out and send it again, and
 * a person would get it twice for the sake of a copy. A copy that could not be made is logged and
 * left: the account has no Sent folder, or the server refused, or the connection ended. The copy
 * is marked read, because the sender wrote it.
 *
 * The copies of the attached files are removed once the message has gone out, and only then: while it
 * has not, the queue sends it again and needs them. Failing to remove one is logged and does not fail
 * the send either, for the same reason.
 */
export async function sendAndFile(
  db: SqlDb,
  environment: SendEnvironment,
  input: ComposeInput,
  imap: ImapSession,
  log: { error(message: string): void },
  options: ComposeOptions = {}
): Promise<SentMessage> {
  const sent = await sendMessage(db, environment, input, options)
  try {
    await environment.files?.remove(input.attachments.map((attached) => attached.path))
  } catch (error) {
    log.error(`the message went out but its attached files could not be removed: ${error instanceof Error ? error.message : String(error)}`)
  }
  try {
    const folder = await getFolderBySpecialUse(db, input.accountId, '\\Sent')
    if (folder) await imap.appendMessage(folder.imapPath, sent.source, ['\\Seen'])
  } catch (error) {
    log.error(`the message went out but could not be filed in Sent: ${error instanceof Error ? error.message : String(error)}`)
  }
  return sent
}
