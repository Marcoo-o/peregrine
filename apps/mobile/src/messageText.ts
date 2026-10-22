import { decodeCharset, decodeMimeWords, encodeBase64 } from '@peregrine/imap/mime'
import { contentIdOf } from './contentIds'
import { childrenOf, parseHeaderValue, splitPart, undoTransferEncoding, type Part } from './mimeParts'

/** A message as the screens show it: the few headers that identify it, its text and its HTML. */
export interface ReadableMessage {
  subject: string
  from: string
  /** Who it is to and who has a copy, as written, with the names decoded. */
  to: string
  cc: string
  /** Who has a blind copy, which only a message that was kept to be written on has: a message that was sent hides it. */
  bcc: string
  date: string
  /** The plain text, or the HTML with its tags taken off when that is all there is. What an answer quotes. */
  text: string
  /** The HTML part as the sender wrote it, or null. Untrusted: it is shown only where nothing in it can run. */
  html: string | null
  /** The headers an answer needs to join the thread, as written, or empty. */
  messageId: string
  references: string
  replyTo: string
  /** Every header by lower case name, as written, the first of those that are repeated. For the verdicts of the server. */
  headers: Record<string, string>
  /** The images the HTML refers to by `cid:`, by content id, as data URLs the HTML can show. */
  inlineImages: Record<string, string>
}

/** The kinds of image that are taken out of a message to be shown inside it. A vector image is not one of them. */
const INLINE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/bmp'])

/** An image bigger than this is not held on to, nor are more than this many of them together. */
const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_INLINE_TOTAL_BYTES = 15 * 1024 * 1024

/** Base64 is a third bigger than what it holds, so a part this long cannot hold an image that fits. */
const MAX_INLINE_IMAGE_ENCODED = Math.ceil(MAX_INLINE_IMAGE_BYTES * 1.4)

/**
 * Reads a message source down to something that can be shown.
 *
 * The text and the HTML of the message itself, the headers, and the images the HTML refers to. Attachments,
 * nested messages and signatures are skipped; `attachments.ts` finds the attachments. This is not a parser
 * for everything mail can be: what cannot be read is left out, and does not make the message unreadable.
 */
export function readMessage(source: Uint8Array): ReadableMessage {
  const top = splitPart(source)
  // plain text wins over HTML for what needs text, and the first of either over the later ones
  const plain = textOf(top, 'text/plain')
  const html = textOf(top, 'text/html')
  const header = (name: string): string => decodeMimeWords(top.headers.get(name) ?? '').trim()
  return {
    subject: header('subject'),
    from: header('from'),
    to: header('to'),
    cc: header('cc'),
    bcc: header('bcc'),
    date: header('date'),
    text: plain ?? (html === null ? '' : stripTags(html)),
    html,
    messageId: header('message-id'),
    references: header('references'),
    replyTo: header('reply-to'),
    headers: Object.fromEntries(top.headers),
    inlineImages: inlineImagesOf(top)
  }
}

/** The text of the first part of the wanted type that is not an attachment, looking inside nested multiparts. */
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

  return decodeCharset(type.params.get('charset') ?? 'us-ascii', undoTransferEncoding(part))
}

/** The images of a message that have a content id, which is what the HTML names them by. */
function inlineImagesOf(top: Part): Record<string, string> {
  const images: Record<string, string> = {}
  let total = 0

  const visit = (part: Part): void => {
    const type = parseHeaderValue(part.headers.get('content-type'))
    if (type.value.startsWith('multipart/')) {
      childrenOf(part).forEach(visit)
      return
    }
    const id = contentIdOf(part.headers.get('content-id'))
    if (!id || !INLINE_IMAGE_TYPES.has(type.value) || id in images) return
    if (part.body.length > MAX_INLINE_IMAGE_ENCODED) return
    const bytes = undoTransferEncoding(part)
    if (bytes.length > MAX_INLINE_IMAGE_BYTES || total + bytes.length > MAX_INLINE_TOTAL_BYTES) return
    total += bytes.length
    images[id] = `data:${type.value};base64,${encodeBase64(bytes)}`
  }

  visit(top)
  return images
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
