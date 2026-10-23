import { encodeAscii } from '@peregrine/imap/utf8'
import {
  addressHeader,
  base64Lines,
  checkedAddress,
  parameter,
  quotedPrintable,
  singleLine,
  textHeader,
  type Address
} from './headers'
import { SmtpError } from './errors'

const CRLF = '\r\n'

export type AddressInput = string | Address

export interface Attachment {
  filename: string
  /** Defaults to application/octet-stream, which is also what anything that is not a type becomes. */
  contentType?: string
  content: Uint8Array
}

export interface ComposeInput {
  from: AddressInput
  to: AddressInput[]
  cc?: AddressInput[]
  /** Kept out of the headers and put into the envelope, which is the point of a blind copy. A draft keeps it in the headers. */
  bcc?: AddressInput[]
  replyTo?: AddressInput
  subject: string
  text?: string
  html?: string
  attachments?: Attachment[]
  /** The Message-ID of the message this one answers, with its angle brackets. */
  inReplyTo?: string
  /** The Message-IDs of the thread, with their angle brackets, as one string or as a list. */
  references?: string | string[]
}

export interface ComposeOptions {
  /** For a fixed date in tests. Defaults to now. */
  now?: Date
  /** For fixed ids in tests. Defaults to Math.random, which an id needs to be unique and not secret. */
  random?: () => number
  /**
   * The message is one that is kept to be written on, and not sent: a blind copy is written into its headers, since
   * it is all the draft has to remember who it is for, and it may have nobody to go to yet. A message that goes out
   * never has a blind copy, and always has somebody it goes to.
   */
  draft?: boolean
}

export interface Composed {
  /** The message as RFC 5322 source, 7-bit, with CR LF line ends. */
  source: Uint8Array
  messageId: string
  /** Who it goes to: to, cc and bcc, once each. Not what the headers say, which leave out bcc. */
  envelope: { from: string; to: string[] }
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MESSAGE_ID = /^<[\x21-\x3b\x3d\x3f-\x7e]+@[\x21-\x3b\x3d\x3f-\x7e]+>$/

/**
 * Builds the source of an outgoing message, the way nodemailer's MailComposer does for the desktop
 * and without anything that wants Node.
 *
 * Everything that goes into a header goes through `singleLine`, and every address is checked, so a
 * subject or a name with a line break in it is one line, and cannot add a header or end them. The
 * result is 7-bit all through: text is quoted-printable or plain, attachments base64, headers
 * encoded, so that it can be sent to a server that never said it takes anything else. An address
 * with characters beyond ASCII is refused. Writing one into a header takes the SMTPUTF8 form of
 * the message, which this does not make.
 */
export function composeMessage(input: ComposeInput, options: ComposeOptions = {}): Composed {
  const now = options.now ?? new Date()
  const random = options.random ?? Math.random

  const from = checkedAddress(input.from)
  const to = input.to.map(checkedAddress)
  const cc = (input.cc ?? []).map(checkedAddress)
  const bcc = (input.bcc ?? []).map(checkedAddress)
  const replyTo = input.replyTo === undefined ? undefined : checkedAddress(input.replyTo)
  // A message that is sent has to go to somebody. A draft is kept to be written on, and often begins with a subject.
  if (options.draft !== true && to.length + cc.length + bcc.length === 0) throw new SmtpError('invalid', 'There is no recipient')

  const domain = from.address.slice(from.address.lastIndexOf('@') + 1)
  const messageId = `<${now.getTime().toString(36)}.${token(random, 12)}@${domain}>`

  const headers = [addressHeader('From', [from])]
  if (to.length > 0) headers.push(addressHeader('To', to))
  if (cc.length > 0) headers.push(addressHeader('Cc', cc))
  if (options.draft === true && bcc.length > 0) headers.push(addressHeader('Bcc', bcc))
  if (replyTo) headers.push(addressHeader('Reply-To', [replyTo]))
  headers.push(textHeader('Subject', input.subject))
  headers.push(`Date: ${rfc5322Date(now)}`)
  headers.push(`Message-ID: ${messageId}`)
  if (input.inReplyTo !== undefined) headers.push(`In-Reply-To: ${checkedMessageId(input.inReplyTo)}`)
  const references = [input.references ?? []].flat().flatMap((value) => singleLine(value).split(/\s+/)).filter(Boolean)
  if (references.length > 0) headers.push(`References: ${references.map(checkedMessageId).join(`${CRLF} `)}`)
  headers.push('MIME-Version: 1.0')

  const body = structure(input, random)
  const source = encodeAscii(`${headers.join(CRLF)}${CRLF}${body.headers.join(CRLF)}${CRLF}${CRLF}${body.text}`)

  const recipients = [...new Set([...to, ...cc, ...bcc].map((a) => a.address))]
  return { source, messageId, envelope: { from: from.address, to: recipients } }
}

/** The body of the message and the headers that describe it: one part, or parts inside parts. */
function structure(input: ComposeInput, random: () => number): { headers: string[]; text: string } {
  const text = input.text ?? ''
  const html = input.html
  const attachments = input.attachments ?? []

  const readable =
    html !== undefined && input.text !== undefined
      ? alternative(text, html, random)
      : html !== undefined
        ? textPart('text/html', html)
        : textPart('text/plain', text)
  if (attachments.length === 0) return readable

  const boundary = unique(random, [readable.text])
  const parts = [part(readable)]
  for (const attachment of attachments) parts.push(part(attachmentPart(attachment)))
  const closed = `--${boundary}--${CRLF}`
  return {
    headers: [`Content-Type: multipart/mixed; boundary="${boundary}"`],
    text: parts.map((p) => `--${boundary}${CRLF}${p}`).join('') + closed
  }
}

function alternative(text: string, html: string, random: () => number): { headers: string[]; text: string } {
  const boundary = unique(random, [text, html])
  const plain = part(textPart('text/plain', text))
  const rich = part(textPart('text/html', html))
  return {
    headers: [`Content-Type: multipart/alternative; boundary="${boundary}"`],
    text: `--${boundary}${CRLF}${plain}--${boundary}${CRLF}${rich}--${boundary}--${CRLF}`
  }
}

/** Text as a part. Plain ASCII with short lines goes as it is, anything else as quoted-printable. */
function textPart(type: string, content: string): { headers: string[]; text: string } {
  const simple = /^[\x00-\x7f]*$/.test(content) && content.split(/\r\n|\r|\n/).every((line) => line.length <= 76) && !/\u0000/.test(content)
  return {
    headers: [
      `Content-Type: ${type}; charset=utf-8`,
      `Content-Transfer-Encoding: ${simple ? '7bit' : 'quoted-printable'}`
    ],
    text: simple ? content.replace(/\r\n|\r|\n/g, CRLF) : quotedPrintable(content)
  }
}

function attachmentPart(attachment: Attachment): { headers: string[]; text: string } {
  const type = attachment.contentType && /^[A-Za-z0-9][\w.+-]*\/[A-Za-z0-9][\w.+-]*$/.test(attachment.contentType)
    ? attachment.contentType
    : 'application/octet-stream'
  const name = singleLine(attachment.filename).replace(/[\\/]/g, '_') || 'attachment'
  return {
    headers: [
      `Content-Type: ${type};${CRLF}\t${parameter('name', name)}`,
      `Content-Disposition: attachment;${CRLF}\t${parameter('filename', name)}`,
      'Content-Transfer-Encoding: base64'
    ],
    text: base64Lines(attachment.content)
  }
}

/** A part as it stands between two boundaries: its headers, an empty line, its content, a line end. */
function part(content: { headers: string[]; text: string }): string {
  const text = content.text.endsWith(CRLF) ? content.text : content.text + CRLF
  return `${content.headers.join(CRLF)}${CRLF}${CRLF}${text}`
}

/**
 * A boundary that is not in any of the text it separates, which a random one practically never is.
 * It still checks, and when a try does fail the next one is told apart by a counter, so that this
 * ends even for a random source that keeps giving the same answer.
 */
function unique(random: () => number, texts: string[]): string {
  for (let attempt = 0; ; attempt++) {
    const boundary = `=_peregrine_${token(random, 24)}${attempt === 0 ? '' : `_${attempt}`}`
    if (!texts.some((text) => text.includes(boundary))) return boundary
  }
}

function checkedMessageId(value: string): string {
  const id = singleLine(value).trim()
  if (!MESSAGE_ID.test(id)) throw new SmtpError('invalid', `"${id.slice(0, 60)}" is not a message id`)
  return id
}

function token(random: () => number, length: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < length; i++) out += alphabet[Math.floor(random() * alphabet.length) % alphabet.length]
  return out
}

/** `Mon, 19 Oct 2026 10:00:00 +0000`. In UTC, which every reader converts for its own zone. */
function rfc5322Date(date: Date): string {
  const two = (n: number): string => String(n).padStart(2, '0')
  return `${DAYS[date.getUTCDay()]}, ${two(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} ` +
    `${two(date.getUTCHours())}:${two(date.getUTCMinutes())}:${two(date.getUTCSeconds())} +0000`
}
