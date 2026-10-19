import { decodeBase64, decodeCharset } from '@peregrine/imap/mime'
import { decodeAscii } from '@peregrine/imap/utf8'

/**
 * The structure of a message source: its parts, their headers, and what is inside them.
 *
 * Just enough MIME to read a message and to find and take out its attachments. It does not try to be
 * a parser for everything mail can be. A part that cannot be read is skipped, and not made into a
 * reason for the whole message to fail.
 */

export interface Part {
  headers: Map<string, string>
  body: Uint8Array
}

/** Everything before the first empty line is header, everything after it is body. */
export function splitPart(bytes: Uint8Array): Part {
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

export interface HeaderValue {
  /** `text/plain` of `text/plain; charset="utf-8"`, in lower case. */
  value: string
  /** The parameters by lower-case name, with RFC 2231 continuations joined and their encoding undone. */
  params: Map<string, string>
}

interface RawParameter {
  name: string
  value: string
}

/**
 * Reads the parameters after the first semicolon: `name=value` where the value is a token or a quoted
 * string, which can hold semicolons and escaped quotes.
 */
function rawParameters(text: string): RawParameter[] {
  const found: RawParameter[] = []
  let i = 0
  while (i < text.length) {
    while (i < text.length && (text[i] === ';' || text[i] === ' ' || text[i] === '\t')) i++
    const eq = text.indexOf('=', i)
    if (eq === -1) break
    const semicolon = text.indexOf(';', i)
    // a name with no value up to the next semicolon is skipped
    if (semicolon !== -1 && semicolon < eq) {
      i = semicolon + 1
      continue
    }
    const name = text.slice(i, eq).trim().toLowerCase()
    i = eq + 1
    while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++
    let value = ''
    if (text[i] === '"') {
      i++
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < text.length) i++
        value += text[i]
        i++
      }
      i++
    } else {
      const next = text.indexOf(';', i)
      const stop = next === -1 ? text.length : next
      value = text.slice(i, stop).trim()
      i = stop
    }
    if (name) found.push({ name, value })
  }
  return found
}

function percentDecode(text: string): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '%' && /^[0-9a-fA-F]{2}$/.test(text.slice(i + 1, i + 3))) {
      out.push(parseInt(text.slice(i + 1, i + 3), 16))
      i += 2
    } else {
      out.push(text.charCodeAt(i) & 0xff)
    }
  }
  return Uint8Array.from(out)
}

/**
 * `text/plain; charset="utf-8"` as a value and its parameters.
 *
 * RFC 2231 is what a file name with an umlaut in it looks like in a message that is not old:
 * `filename*=UTF-8''Gr%C3%BC%C3%9Fe.pdf`, and in several pieces when it is long,
 * `filename*0*=UTF-8''Gr%C3%BC; filename*1*=%C3%9Fe.pdf`. The pieces are put back in order, and
 * those that were encoded are decoded with the charset the first piece names.
 */
export function parseHeaderValue(text: string | undefined): HeaderValue {
  const source = text ?? ''
  const semicolon = source.indexOf(';')
  const value = (semicolon === -1 ? source : source.slice(0, semicolon)).trim().toLowerCase()
  const params = new Map<string, string>()
  if (semicolon === -1) return { value, params }

  const groups = new Map<string, { index: number; encoded: boolean; value: string }[]>()
  for (const { name, value: raw } of rawParameters(source.slice(semicolon + 1))) {
    const match = /^([^*]+)(?:\*(\d+))?(\*)?$/.exec(name)
    if (!match) continue
    const [, base, index, star] = match
    const list = groups.get(base) ?? []
    list.push({ index: index === undefined ? 0 : Number(index), encoded: star === '*', value: raw })
    groups.set(base, list)
  }

  for (const [base, pieces] of groups) {
    pieces.sort((a, b) => a.index - b.index)
    if (!pieces.some((piece) => piece.encoded)) {
      // Plain, or plain pieces of a long value. A name given both ways is taken the plain way.
      params.set(base, pieces.map((piece) => piece.value).join(''))
      continue
    }
    let charset = 'us-ascii'
    let bytes: number[] = []
    pieces.forEach((piece, position) => {
      let data = piece.value
      if (piece.encoded) {
        if (position === 0) {
          const header = /^([^']*)'[^']*'(.*)$/s.exec(data)
          if (header) {
            charset = header[1] || 'us-ascii'
            data = header[2]
          }
        }
        bytes = bytes.concat(Array.from(percentDecode(data)))
      } else {
        bytes = bytes.concat(Array.from(data, (c) => c.charCodeAt(0) & 0xff))
      }
    })
    params.set(base, decodeCharset(charset, Uint8Array.from(bytes)))
  }
  return { value, params }
}

/** The parts between the boundaries of a multipart body. */
export function splitMultipart(body: Uint8Array, boundary: string): Uint8Array[] {
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

/** The content of a part with its transfer encoding undone. */
export function undoTransferEncoding(part: Part): Uint8Array {
  const encoding = (part.headers.get('content-transfer-encoding') ?? '').trim().toLowerCase()
  if (encoding === 'base64') return decodeBase64(decodeAscii(part.body))
  if (encoding === 'quoted-printable') return decodeQuotedPrintable(decodeAscii(part.body))
  return part.body
}

export function decodeQuotedPrintable(text: string): Uint8Array {
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

/** The children of a multipart part, or an empty list for a part that is not one. */
export function childrenOf(part: Part): Part[] {
  const type = parseHeaderValue(part.headers.get('content-type'))
  if (!type.value.startsWith('multipart/')) return []
  const boundary = type.params.get('boundary')
  if (!boundary) return []
  return splitMultipart(part.body, boundary).map(splitPart)
}
