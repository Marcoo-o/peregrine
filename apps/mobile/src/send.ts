import type { ImapSession } from '@peregrine/core/imapSession'
import type { SecureMode, ComposeInput } from '@peregrine/core/types'
import type { SqlDb } from '@peregrine/core/sqlDb'
import type { Transport } from '@peregrine/imap/transport'
import { SmtpClient, type SendResult } from '@peregrine/smtp/client'
import { composeMessage, type ComposeOptions } from '@peregrine/smtp/compose'
import { getAccount, type Account } from './accounts'
import { getFolderBySpecialUse } from './folders'

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

/**
 * Sends one message from the application and says who it went to, with the source that went out.
 * Throws, with the reason, when it did not: the queue keeps a message whose sending threw and tries
 * it again.
 *
 * It refuses what the phone cannot do yet, and says so, where the alternative is sending something
 * other than what was written: attachments are not read from the phone's files, a message to be
 * encrypted or signed would go out in the clear, and one for a later time would go out now.
 */
export async function sendMessage(
  db: SqlDb,
  makeTransport: () => Transport,
  input: ComposeInput,
  options: ComposeOptions = {}
): Promise<SentMessage> {
  const account = await getAccount(db, input.accountId)
  if (!account) throw new Error('The account this message was written for is gone')
  if (input.attachments.length > 0) throw new Error('Attachments cannot be sent from the phone yet')
  if (input.encrypt || input.sign) throw new Error('Encrypting and signing are not on the phone yet')
  if (input.sendAt !== undefined && input.sendAt > Date.now()) {
    throw new Error('Sending at a later time is not on the phone yet')
  }
  if (!account.emailAddress) throw new Error('This account has no address to send from')
  const settings = smtpSettingsOf(account)
  if (!settings) throw new Error('This account has no server for sending')

  const composed = composeMessage(
    {
      // A name that is only the address again says nothing, and shows twice in a mail client.
      from: { name: account.displayName === account.emailAddress ? undefined : account.displayName, address: account.emailAddress },
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      text: input.textBody,
      html: input.htmlBody === '' ? undefined : input.htmlBody,
      inReplyTo: input.inReplyTo,
      references: input.references
    },
    options
  )

  const client = new SmtpClient(makeTransport(), settings)
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
 */
export async function sendAndFile(
  db: SqlDb,
  makeTransport: () => Transport,
  input: ComposeInput,
  imap: ImapSession,
  log: { error(message: string): void },
  options: ComposeOptions = {}
): Promise<SentMessage> {
  const sent = await sendMessage(db, makeTransport, input, options)
  try {
    const folder = await getFolderBySpecialUse(db, input.accountId, '\\Sent')
    if (folder) await imap.appendMessage(folder.imapPath, sent.source, ['\\Seen'])
  } catch (error) {
    log.error(`the message went out but could not be filed in Sent: ${error instanceof Error ? error.message : String(error)}`)
  }
  return sent
}
