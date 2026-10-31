import { attachPicked, emptyDraft, type Draft, type RefusedFile } from './draft'
import type { FileAccess, PickedFile } from './files'
import { t, tn } from './i18n'

/**
 * What another application asked of this one: a link to an address, or something it shared. The platform
 * reads the intent and copies the files; what is made of it is decided here, where it can be tested.
 */
export interface Incoming {
  /** The `mailto:` link that was opened, or null when something was shared. */
  mailto: string | null
  subject: string
  text: string
  /** The addresses the sharing application named, which it does for an address book's "send mail". */
  to: string[]
  cc: string[]
  bcc: string[]
  /** What was shared, already copied into the application's storage like a picked file. */
  files: PickedFile[]
  /** How many files were shared that could not be read, so that a message without a file is not mistaken for one that never had it. */
  unreadable: number
}

/** Longest text taken as a body: a page shared as text is not a reason to hold megabytes on a screen. */
const MAX_BODY = 200_000

/** What a link of the form `mailto:` carries. Everything else a link may say is left unread, `attach` first of all. */
export interface MailtoFields {
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  body: string
}

function decoded(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    // A percent sign that starts nothing: the text as it was written is the best reading of it.
    return text
  }
}

/** Addresses of a list that is separated by commas, each decoded and none empty. */
function addresses(list: string): string[] {
  return decoded(list)
    .split(',')
    .map((address) => address.trim())
    .filter((address) => address !== '')
}

/**
 * Reads a link of the form `mailto:` (RFC 6068): addresses in front of the question mark, and `to`, `cc`, `bcc`, `subject` and
 * `body` after it. The fields are plain text. A line break in a body is `%0D%0A` and is made one. What the link says
 * besides these, `attach` which would name a file of this phone, `in-reply-to` and the rest, is not read: a link in a web page
 * is not to decide what a message refers to or carries. Returns null for what is not such a link.
 */
export function parseMailto(link: string): MailtoFields | null {
  const match = /^mailto:([^?]*)(?:\?(.*))?$/is.exec(link.trim())
  if (!match) return null
  const fields: MailtoFields = { to: addresses(match[1]), cc: [], bcc: [], subject: '', body: '' }
  for (const pair of (match[2] ?? '').split('&')) {
    const at = pair.indexOf('=')
    if (at < 0) continue
    const name = pair.slice(0, at).toLowerCase()
    const value = pair.slice(at + 1)
    if (name === 'to') fields.to.push(...addresses(value))
    else if (name === 'cc') fields.cc.push(...addresses(value))
    else if (name === 'bcc') fields.bcc.push(...addresses(value))
    // Plus is a space in a form and itself in a link: the link is read as one.
    else if (name === 'subject') fields.subject = decoded(value).replace(/\s+/g, ' ').trim()
    else if (name === 'body') fields.body = decoded(value).replace(/\r\n?/g, '\n')
  }
  return fields
}

const unique = (values: string[]): string[] => {
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = value.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** What the files that were shared did not bring: the ones that are too large, as a line for the screen. */
export function refusedText(refused: RefusedFile[]): string | undefined {
  if (refused.length === 0) return undefined
  const names = refused.map((file) => file.name).join(', ')
  return refused.length === 1
    ? t('Die Datei {names} ist zu groß für eine Nachricht und wurde nicht angehängt.', { names })
    : t('Diese Dateien sind zu groß für eine Nachricht und wurden nicht angehängt: {names}.', { names })
}

/** The line for files that were shared and could not be read. */
export function unreadableText(count: number): string | undefined {
  if (count <= 0) return undefined
  return tn(count, 'Eine Datei konnte nicht gelesen werden und fehlt.', '{count} Dateien konnten nicht gelesen werden und fehlen.')
}

/**
 * The message that something another application asked for starts. A link brings its addresses, subject and body; a sharing brings
 * text as the body and files as attachments, with the subject if the other application gave one. Text that was shared is
 * put under what a link says, not over it: both can be given at once by an application that is careless.
 */
export async function draftFromIncoming(incoming: Incoming, files: FileAccess): Promise<{ draft: Draft; error?: string }> {
  const link = incoming.mailto === null ? null : parseMailto(incoming.mailto)
  const body = [link?.body ?? '', incoming.text].filter((part) => part !== '').join('\n\n')
  const { attachments, refused } = await attachPicked([], incoming.files, files)
  return {
    draft: {
      ...emptyDraft,
      to: unique([...(link?.to ?? []), ...incoming.to]).join(', '),
      cc: unique([...(link?.cc ?? []), ...incoming.cc]).join(', '),
      bcc: unique([...(link?.bcc ?? []), ...incoming.bcc]).join(', '),
      subject: link?.subject || incoming.subject.replace(/\s+/g, ' ').trim(),
      body: body.slice(0, MAX_BODY),
      attachments
    },
    error: [refusedText(refused), unreadableText(incoming.unreadable)].filter((line) => line !== undefined).join(' ') || undefined
  }
}
