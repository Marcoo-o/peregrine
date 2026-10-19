import { decodeBase64, decodeCharset, decodeMimeWords } from '@peregrine/imap/mime'
import { decodeAscii } from '@peregrine/imap/utf8'

/** A message as the prototype shows it: the few headers that identify it, and its text. */
export interface ReadableMessage {
  subject: string
  from: string
  date: string
  text: string
}

interface Part {
  headers: Map<string, string>
  body: Uint8Array
}

/**
 * Reads a message source down to something that can be shown.
 *
 * This is the least that makes a message readable and no more: the first plain text part, or the
 * HTML one with its tags taken off when there is no other. Attachments, inline images, nested
 * messages and signatures are skipped. The desktop uses a full parser for this. Which one the
 * phone gets is a decision for a later stage, so this stays small enough to throw away.
 */
export function readMessage(source: Uint8Array): ReadableMessage {
  const top = splitPart(source)
  // plain text wins over HTML, and the first of either over the later ones
  const text = textOf(top, 'text/plain') ?? textOf(top, 'text/html') ?? ''
  const header = (name: string): string => decodeMimeWords(top.headers.get(name) ?? '').trim()
  return { subject: header('subject'), from: header('from'), date: header('date'), text }
}

/** Everything before the first empty line is header, everything after it is body. */
function splitPart(bytes: Uint8Array): Part {
  let end = -1
  let bodyStart = bytes.length
  for (let i = 0; i + 1 < bytes.length; i++) {
    if (bytes[i] === 10 && bytes[i + 1] === 10) {
      end = i
      bodyStart = i + 2
      break
    }
    if (bytes[i] === 13 && bytes[i + 1] === 10 && bytes[i + 2] === 13 && bytes[i + 3] === 10) {
      end = i
      bodyStart = i + 4
      break
    }
  }
  const head = decodeAscii(bytes, 0, end === -1 ? bytes.length : end)
  const headers = new Map<string, string>()
  // A header continues on the next line when that begins with whitespace.
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon > 0) {
      const name = line.slice(0, colon).trim().toLowerCase()
      if (!headers.has(name)) headers.set(name, line.slice(colon + 1).trim())
    }
  }
  return { headers, body: bytes.subarray(bodyStart) }
}

/** `text/plain; charset="utf-8"` as a value and its parameters. */
function parseValue(text: string | undefined): { value: string; params: Map<string, string> } {
  const [first, ...rest] = (text ?? '').split(';')
  const params = new Map<string, string>()
  for (const piece of rest) {
    const eq = piece.indexOf('=')
    if (eq > 0) {
      params.set(piece.slice(0, eq).trim().toLowerCase(), piece.slice(eq + 1).trim().replace(/^"|"$/g, ''))
    }
  }
  return { value: first.trim().toLowerCase(), params }
}

/** The text of a part that is of the wanted type, looking inside nested multiparts. */
function textOf(part: Part, wanted: string): string | null {
  const type = parseValue(part.headers.get('content-type'))
  const kind = type.value || 'text/plain'
  if (kind.startsWith('multipart/')) {
    const boundary = type.params.get('boundary')
    if (!boundary) return null
    for (const child of splitMultipart(part.body, boundary).map(splitPart)) {
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

function splitMultipart(body: Uint8Array, boundary: string): Uint8Array[] {
  const text = decodeAscii(body)
  const marker = `--${boundary}`
  const parts: Uint8Array[] = []
  let from = -1
  let at = text.indexOf(marker)
  while (at !== -1) {
    if (from !== -1) parts.push(body.subarray(from, trimLineBreak(text, at)))
    const after = at + marker.length
    if (text.startsWith('--', after)) break
    // The part starts on the line after the marker.
    const lineEnd = text.indexOf('\n', after)
    from = lineEnd === -1 ? text.length : lineEnd + 1
    at = text.indexOf(`\n${marker}`, from)
    if (at !== -1) at += 1
  }
  return parts
}

/** The line break before a boundary belongs to the boundary and not to the part. */
function trimLineBreak(text: string, at: number): number {
  if (at > 1 && text[at - 1] === '\n') return text[at - 2] === '\r' ? at - 2 : at - 1
  return at
}

function undoTransferEncoding(part: Part): Uint8Array {
  const encoding = (part.headers.get('content-transfer-encoding') ?? '').trim().toLowerCase()
  if (encoding === 'base64') return decodeBase64(decodeAscii(part.body))
  if (encoding === 'quoted-printable') return decodeQuotedPrintable(decodeAscii(part.body))
  return part.body
}

function decodeQuotedPrintable(text: string): Uint8Array {
  const out: number[] = []
  // A soft line break is an equals sign at the end of a line.
  const joined = text.replace(/=\r?\n/g, '')
  for (let i = 0; i < joined.length; i++) {
    const c = joined[i]
    if (c === '=' && /^[0-9a-fA-F]{2}$/.test(joined.slice(i + 1, i + 3))) {
      out.push(parseInt(joined.slice(i + 1, i + 3), 16))
      i += 2
    } else {
      out.push(joined.charCodeAt(i) & 0xff)
    }
  }
  return Uint8Array.from(out)
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
