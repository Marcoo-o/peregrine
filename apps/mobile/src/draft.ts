import type { ComposeInput, EmailAddress } from '@peregrine/core/types'
import { parseAddress } from '@peregrine/smtp/headers'
import { MAX_ATTACHMENT_BYTES, type FileAccess, type PickedFile } from './files'
import type { ReadableMessage } from './messageText'
import { t } from './i18n'

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
  /** Who gets a copy that the others do not see. */
  bcc: string
  subject: string
  body: string
  attachments: DraftAttachment[]
  inReplyTo?: string
  references?: string
  /** The content is to be readable only by those the message goes to. */
  encrypt?: boolean
  /** The content is to carry a signature that says who wrote it. */
  sign?: boolean
  /** Which of the account's identities the message is from: its name and address. Without one, the account's own. */
  identityId?: string
}

export const emptyDraft: Draft = { to: '', cc: '', bcc: '', subject: '', body: '', attachments: [] }

/**
 * The draft of a message that was kept as one, to be written on, or the reason it cannot be: saving it again would
 * leave out what the phone cannot show or write, and the server's copy would lose it. That is a formatted text (the phone
 * writes plain text only). The blind copy is shown and written, and is kept in a draft. The attached files are not in the
 * draft this gives: they are made files of the phone (`bringAttachments`) and put on it, since that takes the files.
 */
export function editableDraft(message: ReadableMessage): { draft: Draft } | { refusal: string } {
  if (message.html !== null) {
    return { refusal: t('Dieser Entwurf hat eine Formatierung, die das Handy noch nicht bearbeiten kann, ohne sie zu verlieren.') }
  }
  return {
    draft: {
      to: message.to,
      cc: message.cc,
      bcc: message.bcc,
      subject: message.subject,
      body: message.text,
      attachments: [],
      inReplyTo: message.headers['in-reply-to']?.trim() || undefined,
      references: message.references || undefined
    }
  }
}

/** Whether the user has changed a draft from the one it started as, so that leaving it would lose something. */
export function isChanged(start: Draft, now: Draft): boolean {
  const files = (draft: Draft) => draft.attachments.map((file) => file.path).join('|')
  return (
    start.to !== now.to ||
    start.cc !== now.cc ||
    start.bcc !== now.bcc ||
    start.subject !== now.subject ||
    start.body !== now.body ||
    (start.encrypt === true) !== (now.encrypt === true) ||
    (start.sign === true) !== (now.sign === true) ||
    files(start) !== files(now)
  )
}

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
  const heading = t('Am {n} schrieb {n2}:', { n: message.date || t('einem früheren Zeitpunkt'), n2: message.from || t('der Absender') })
  const references = [message.references, message.messageId].filter((value) => value !== '').join(' ')
  return {
    to: message.replyTo || message.from,
    cc: '',
    bcc: '',
    subject: replySubject(message.subject),
    body: `\n\n${heading}\n${quoted}\n`,
    attachments: [],
    inReplyTo: message.messageId || undefined,
    references: references || undefined
  }
}

/** An address as it is typed into a field: the name in quotes when it holds anything that would split it. */
export function written(address: EmailAddress): string {
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
 * attachments are not in the draft this gives: they are made files of the phone and put on it (`bringAttachments`).
 */
export function forwardDraft(message: ReadableMessage): Draft {
  const subject = /^\s*(fwd?|wg):/i.test(message.subject) ? message.subject.trim() : t('Fwd: {n}', { n: message.subject.trim() }).trim()
  const text = message.text.replace(/\r\n/g, '\n').replace(/\n+$/, '')
  const body =
    t('\n\n---------- Weitergeleitete Nachricht ----------\n') +
    t('Von: {from}\n', { from: message.from }) +
    t('Datum: {date}\n', { date: message.date }) +
    t('Betreff: {subject}\n', { subject: message.subject }) +
    `An: ${message.to}\n\n` +
    `${text}\n`
  return { to: '', cc: '', bcc: '', subject, body, attachments: [] }
}

/** The input of the queue and of sending, from what was typed. */
export function toComposeInput(accountId: string, draft: Draft): ComposeInput {
  return {
    accountId,
    to: parseAddressList(draft.to),
    cc: parseAddressList(draft.cc),
    bcc: parseAddressList(draft.bcc),
    subject: draft.subject,
    textBody: draft.body,
    htmlBody: '',
    attachments: draft.attachments.map(({ filename, path, contentType }) => ({ filename, path, contentType })),
    inReplyTo: draft.inReplyTo,
    references: draft.references,
    encrypt: draft.encrypt === true ? true : undefined,
    sign: draft.sign === true ? true : undefined,
    identityId: draft.identityId
  }
}

/**
 * The draft a queued message was made from, to write on it again: the inverse of `toComposeInput`. The queue keeps the files by their path and
 * not their size, so an attachment is listed with none; the limit for what can be attached counts it as nothing until it is sent.
 */
export function draftFromInput(input: ComposeInput): Draft {
  const text = (list: EmailAddress[]) => list.map(written).join(', ')
  return {
    to: text(input.to),
    cc: text(input.cc),
    bcc: text(input.bcc),
    subject: input.subject,
    body: input.textBody,
    attachments: input.attachments.map((file) => ({ filename: file.filename, path: file.path, contentType: file.contentType ?? 'application/octet-stream', size: 0 })),
    inReplyTo: input.inReplyTo,
    references: input.references,
    encrypt: input.encrypt === true ? true : undefined,
    sign: input.sign === true ? true : undefined,
    identityId: input.identityId
  }
}

/** The addresses a draft goes to, in all three fields, as they are typed. */
export function recipientAddresses(draft: Draft): string[] {
  return [...parseAddressList(draft.to), ...parseAddressList(draft.cc), ...parseAddressList(draft.bcc)].map((address) => address.address)
}

/** Whether there is anything to send to: the screen enables its button on this. */
export function hasRecipient(draft: Draft): boolean {
  return splitAddressList(`${draft.to},${draft.cc},${draft.bcc}`).length > 0
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
