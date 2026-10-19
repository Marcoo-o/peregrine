import { decodeCharset, decodeMimeWords } from '@peregrine/imap/mime'
import { childrenOf, parseHeaderValue, splitPart, undoTransferEncoding, type Part } from './mimeParts'

/** A message as the prototype shows it: the few headers that identify it, and its text. */
export interface ReadableMessage {
  subject: string
  from: string
  date: string
  text: string
  /** The headers an answer needs to join the thread, as written, or empty. */
  messageId: string
  references: string
  replyTo: string
}

/**
 * Reads a message source down to something that can be shown.
 *
 * This is the least that makes a message readable and no more: the first plain text part, or the
 * HTML one with its tags taken off when there is no other. Attachments, inline images, nested
 * messages and signatures are skipped; `attachments.ts` finds the attachments. The desktop uses a
 * full parser for this. Which one the phone gets is a decision for a later stage, so this stays small
 * enough to throw away.
 */
export function readMessage(source: Uint8Array): ReadableMessage {
  const top = splitPart(source)
  // plain text wins over HTML, and the first of either over the later ones
  const text = textOf(top, 'text/plain') ?? textOf(top, 'text/html') ?? ''
  const header = (name: string): string => decodeMimeWords(top.headers.get(name) ?? '').trim()
  return {
    subject: header('subject'),
    from: header('from'),
    date: header('date'),
    text,
    messageId: header('message-id'),
    references: header('references'),
    replyTo: header('reply-to')
  }
}

/** The text of a part that is of the wanted type, looking inside nested multiparts. */
function textOf(part: Part, wanted: string): string | null {
  const type = parseHeaderValue(part.headers.get('content-type'))
  const kind = type.value || 'text/plain'
  if (kind.startsWith('multipart/')) {
    for (const child of childrenOf(part)) {
      const found = textOf(child, wanted)
      if (found !== null) return found
    }
    return null
  }
  if (kind !== wanted) return null
  if ((part.headers.get('content-disposition') ?? '').toLowerCase().startsWith('attachment')) return null

  const bytes = undoTransferEncoding(part)
  const text = decodeCharset(type.params.get('charset') ?? 'us-ascii', bytes)
  return kind === 'text/html' ? stripTags(text) : text
}

function stripTags(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>|<\/h\d>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
