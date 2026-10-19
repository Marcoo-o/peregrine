import type { SecureMode, ComposeInput } from '@peregrine/core/types'
import type { SqlDb } from '@peregrine/core/sqlDb'
import type { Transport } from '@peregrine/imap/transport'
import { SmtpClient, type SendResult } from '@peregrine/smtp/client'
import { composeMessage, type ComposeOptions } from '@peregrine/smtp/compose'
import { getAccount, type Account } from './accounts'

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
 * Sends one message from the application and says who it went to. Throws, with the reason, when it
 * did not: the queue keeps a message whose sending threw and tries it again.
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
): Promise<SendResult> {
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
    return await client.send({ from: composed.envelope.from, to: composed.envelope.to, data: composed.source })
  } finally {
    await client.close()
  }
}
