import type { ComposeInput, EmailAddress } from '@peregrine/core/types'
import { parseAddress } from '@peregrine/smtp/headers'
import { MAX_ATTACHMENT_BYTES, type FileAccess, type PickedFile } from './files'
import type { ReadableMessage } from './messageText'

/** A file attached to a draft: a copy in the application's storage, and what to show of it. */
export interface DraftAttachment {
  filename: string
  path: string
  contentType: string
  size: number
}

/** A message as the compose screen holds it: what was typed, before it is checked. */
export interface Draft {
  to: string
  cc: string
  subject: string
  body: string
  attachments: DraftAttachment[]
  inReplyTo?: string
  references?: string
}

export const emptyDraft: Draft = { to: '', cc: '', subject: '', body: '', attachments: [] }

/**
 * Splits a list of addresses as it is typed, at commas and semicolons that are not inside a name in
 * quotes or an address in angle brackets: `"Anna, B" <a@example.net>, c@example.net` is two.
 */
export function splitAddressList(text: string): string[] {
  const parts: string[] = []
  let current = ''
  let quoted = false
  let angled = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '\\' && quoted) {
      current += c + (text[++i] ?? '')
      continue
    }
    if (c === '"') quoted = !quoted
    else if (!quoted && c === '<') angled = true
    else if (!quoted && c === '>') angled = false
    if ((c === ',' || c === ';') && !quoted && !angled) {
      parts.push(current)
      current = ''
    } else current += c
  }
  parts.push(current)
  return parts.map((part) => part.trim()).filter((part) => part !== '')
}

/** The addresses of a typed list. Whether each is one is for the composer to say when it is sent. */
export function parseAddressList(text: string): EmailAddress[] {
  return splitAddressList(text).map((part) => {
    const { name, address } = parseAddress(part)
    return { name: name ?? '', address }
  })
}

/** "Re: " once, however many answers the subject has been through. */
export function replySubject(subject: string): string {
  return /^\s*re:/i.test(subject) ? subject.trim() : `Re: ${subject.trim()}`.trim()
}

/**
 * The start of an answer to a message: the Reply-To address or else the sender, the subject, the thread
 * it belongs to and the original quoted line by line.
 */
export function replyDraft(message: ReadableMessage): Draft {
  const quoted = message.text
    .replace(/\r\n/g, '\n')
    .replace(/\n+$/, '')
    .split('\n')
    .map((line) => (line.startsWith('>') ? `>${line}` : `> ${line}`).trimEnd())
    .join('\n')
  const heading = `Am ${message.date || 'einem früheren Zeitpunkt'} schrieb ${message.from || 'der Absender'}:`
  const references = [message.references, message.messageId].filter((value) => value !== '').join(' ')
  return {
    to: message.replyTo || message.from,
    cc: '',
    subject: replySubject(message.subject),
    body: `\n\n${heading}\n${quoted}\n`,
    attachments: [],
    inReplyTo: message.messageId || undefined,
    references: references || undefined
  }
}

/** An address as it is typed into a field: the name in quotes when it holds anything that would split it. */
function written(address: EmailAddress): string {
  if (!address.name) return address.address
  const name = /[",;<>@()[\]:\\]/.test(address.name) ? `"${address.name.replace(/(["\\])/g, '\\$1')}"` : address.name
  return `${name} <${address.address}>`
}

/** The addresses of lists, in order, each once whatever case it is written in, and none of those left out. */
function distinct(lists: string[], leaveOut: string[]): EmailAddress[] {
  const seen = new Set(leaveOut.map((address) => address.toLowerCase()))
  const found: EmailAddress[] = []
  for (const address of lists.flatMap(parseAddressList)) {
    const key = address.address.toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    found.push(address)
  }
  return found
}

/**
 * An answer to everybody the message went to: the sender, or the Reply-To address that stands in for the
 * sender, and the others it was sent to, with the copies kept as copies. The address the answer is written
 * from is left out, so that it does not write to itself, and nobody is named twice.
 */
export function replyAllDraft(message: ReadableMessage, ownAddress: string): Draft {
  const own = ownAddress ? [ownAddress] : []
  const to = distinct([message.replyTo || message.from, message.to], own)
  const cc = distinct([message.cc], [...own, ...to.map((address) => address.address)])
  return { ...replyDraft(message), to: to.map(written).join(', '), cc: cc.map(written).join(', ') }
}

/**
 * A message to be passed on: no recipient yet, "Fwd:" once in front of the subject, and the message under a
 * line that says what it is, with who wrote it and when. It is not part of the thread it came from. Its
 * attachments are not passed on yet.
 */
export function forwardDraft(message: ReadableMessage): Draft {
  const subject = /^\s*(fwd?|wg):/i.test(message.subject) ? message.subject.trim() : `Fwd: ${message.subject.trim()}`.trim()
  const text = message.text.replace(/\r\n/g, '\n').replace(/\n+$/, '')
  const body =
    '\n\n---------- Weitergeleitete Nachricht ----------\n' +
    `Von: ${message.from}\n` +
    `Datum: ${message.date}\n` +
    `Betreff: ${message.subject}\n` +
    `An: ${message.to}\n\n` +
    `${text}\n`
  return { to: '', cc: '', subject, body, attachments: [] }
}

/** The input of the queue and of sending, from what was typed. */
export function toComposeInput(accountId: string, draft: Draft): ComposeInput {
  return {
    accountId,
    to: parseAddressList(draft.to),
    cc: parseAddressList(draft.cc),
    bcc: [],
    subject: draft.subject,
    textBody: draft.body,
    htmlBody: '',
    attachments: draft.attachments.map(({ filename, path, contentType }) => ({ filename, path, contentType })),
    inReplyTo: draft.inReplyTo,
    references: draft.references
  }
}

/** Whether there is anything to send to: the screen enables its button on this. */
export function hasRecipient(draft: Draft): boolean {
  return splitAddressList(`${draft.to},${draft.cc}`).length > 0
}

/** Why a picked file was not attached. */
export interface RefusedFile {
  name: string
  reason: 'tooLarge'
}

/**
 * Adds what was picked to what is attached. A file that is already attached is not attached twice,
 * and one that would take the message over the limit is refused and its copy removed, because nothing
 * will ever read it. What is refused is said, and not left out in silence: a message that goes out
 * without the file somebody thought was in it is the worst way for this to go wrong.
 */
export async function attachPicked(
  current: DraftAttachment[],
  picked: PickedFile[],
  files: FileAccess,
  limit: number = MAX_ATTACHMENT_BYTES
): Promise<{ attachments: DraftAttachment[]; refused: RefusedFile[] }> {
  const attachments = [...current]
  const refused: RefusedFile[] = []
  const discard: string[] = []
  let total = attachments.reduce((sum, attachment) => sum + attachment.size, 0)
  for (const file of picked) {
    if (attachments.some((attachment) => attachment.path === file.path)) continue
    if (total + file.size > limit) {
      refused.push({ name: file.name, reason: 'tooLarge' })
      discard.push(file.path)
      continue
    }
    total += file.size
    attachments.push({ filename: file.name, path: file.path, contentType: file.contentType, size: file.size })
  }
  await files.remove(discard)
  return { attachments, refused }
}

/** Takes one attachment off a draft and removes its copy. */
export async function detachFile(
  current: DraftAttachment[],
  path: string,
  files: FileAccess
): Promise<DraftAttachment[]> {
  await files.remove([path])
  return current.filter((attachment) => attachment.path !== path)
}
