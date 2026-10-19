import { encodeBase64 } from '@peregrine/imap/mime'
import { encodeUtf8 } from '@peregrine/imap/utf8'
import { SmtpError } from './errors'

const CRLF = '\r\n'
/** What a line of a message should not be longer than, RFC 5322. The limit that cannot be passed is 998. */
const LINE = 76

/** Control characters, which no header value has any use for and some can use to break one in two. */
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u0085\u2028\u2029]/g

/**
 * Makes text safe to be the value of a header: line breaks become a space, other controls go.
 *
 * A header ends at the first line break. A subject that carries one and a header after it would
 * add that header to the message, a Bcc for instance, or end the headers and begin the body. The
 * breaks are not escaped but removed, and this is the one place every value passes through.
 */
export function singleLine(text: string): string {
  // A run of breaks is one space, so that a blank line does not become two.
  return text.replace(/(?:\r\n|\r|\n)+/g, ' ').replace(CONTROLS, '')
}

/** True when the text is printable ASCII, spaces included, and so needs no encoding in a header. */
function isPlain(text: string): boolean {
  return /^[\x20-\x7e]*$/.test(text)
}

/**
 * Text for a header, the way RFC 2047 writes what is not ASCII: `=?UTF-8?B?…?=`, in words that are
 * cut between characters and never inside one, and joined with a fold. A header reader joins them
 * back, and drops the space between two words, which is why the spaces of the text are inside the
 * words and not between them.
 *
 * ASCII text is left as it is, apart from being folded when it is long. `prefix` is the length of
 * what comes before on the first line, `Subject: ` for instance, so that line is not made too long.
 */
export function encodeText(value: string, prefix = 0): string {
  const text = singleLine(value)
  // A literal "=?" would be taken for the start of an encoded word by the reader.
  if (isPlain(text) && !text.includes('=?')) return foldWords(text, prefix)

  const words: string[] = []
  let first = true
  let chunk: number[] = []
  const limit = (): number => {
    // 12 characters are the frame of a word: =?UTF-8?B? and ?=. What is left carries 3 bytes for 4.
    const room = (first ? LINE - prefix : LINE - 1) - 12
    return Math.max(1, Math.floor(Math.floor(room / 4) * 3))
  }
  const flush = (): void => {
    if (chunk.length === 0) return
    words.push(`=?UTF-8?B?${encodeBase64(Uint8Array.from(chunk))}?=`)
    chunk = []
    first = false
  }
  for (const char of text) {
    const bytes = encodeUtf8(char)
    if (chunk.length + bytes.length > limit()) flush()
    chunk.push(...bytes)
  }
  flush()
  return words.join(`${CRLF} `)
}

/** Folds ASCII text at its spaces, so that no line passes the recommended length. */
function foldWords(text: string, prefix: number): string {
  if (prefix + text.length <= LINE) return text
  const lines: string[] = []
  let line = ''
  let room = LINE - prefix
  for (const word of text.split(' ')) {
    if (line !== '' && line.length + 1 + word.length > room) {
      lines.push(line)
      line = word
      room = LINE - 1
    } else {
      line = line === '' ? word : `${line} ${word}`
    }
  }
  lines.push(line)
  return lines.join(`${CRLF} `)
}

export interface Address {
  name?: string
  address: string
}

/**
 * Takes an address as it is written in a form or a header, `Anna <anna@example.net>` or a bare
 * `anna@example.net`, and splits it. Anything that is not one of those two shapes is refused: this
 * does not try to read the whole of RFC 5322.
 */
export function parseAddress(input: string | Address): Address {
  if (typeof input !== 'string') return input
  const match = /^\s*(?:(.*?)\s*)?<([^<>]*)>\s*$/.exec(input)
  if (match) {
    const name = match[1]?.replace(/^"(.*)"$/, (_all, inner: string) => inner.replace(/\\(.)/g, '$1'))
    return name ? { name, address: match[2] } : { address: match[2] }
  }
  return { address: input.trim() }
}

/** An address that can be put into a header, or an `SmtpError` of the kind `invalid`. */
export function checkedAddress(input: string | Address): Address {
  const { name, address } = parseAddress(input)
  const clean = address.trim()
  if (clean === '' || !/^[\x21-\x7e]+$/.test(clean) || /[<>"\\,;:()[\]]/.test(clean) || (clean.match(/@/g) ?? []).length !== 1) {
    throw new SmtpError('invalid', `"${singleLine(address).slice(0, 60)}" is not an address that can be put into a message`)
  }
  const at = clean.indexOf('@')
  if (at < 1 || at === clean.length - 1) {
    throw new SmtpError('invalid', `"${clean.slice(0, 60)}" is not of the form name@domain`)
  }
  return name === undefined || singleLine(name).trim() === '' ? { address: clean } : { name: singleLine(name).trim(), address: clean }
}

/** The name in front of an address: as it is, quoted when it has characters that need it, or encoded. */
function phrase(name: string, prefix: number): string {
  if (!isPlain(name) || name.includes('=?')) return encodeText(name, prefix)
  if (/^[A-Za-z0-9 !#$%&'*+\-/=?^_`{|}~]+$/.test(name)) return name
  return `"${name.replace(/[\\"]/g, '\\$&')}"`
}

/** One address as it goes into a header. */
export function formatAddress(address: Address, prefix = 0): string {
  return address.name ? `${phrase(address.name, prefix)} <${address.address}>` : address.address
}

/** A header whose value is a list of addresses, folded between them so that no line is too long. */
export function addressHeader(name: string, addresses: Address[]): string {
  const start = `${name}: `
  const lines: string[] = []
  let line = start
  addresses.forEach((address, index) => {
    const text = formatAddress(address, line.length) + (index < addresses.length - 1 ? ',' : '')
    if (line !== start && line.length + 1 + text.length > LINE && line.trim() !== '') {
      lines.push(line)
      line = ` ${text}`
    } else {
      line += line === start ? text : ` ${text}`
    }
  })
  lines.push(line)
  return lines.join(CRLF)
}

/** A header whose value is text, encoded and folded. */
export function textHeader(name: string, value: string): string {
  return `${name}: ${encodeText(value, name.length + 2)}`
}

/**
 * A parameter of a header such as `filename`, for a value that may not be ASCII. Both forms are
 * written when it is not: the plain one with the characters it cannot carry replaced, for a reader
 * that does not know the other, and RFC 2231's `filename*=UTF-8''…`, for the ones that do and show the
 * name as it is.
 */
export function parameter(name: string, value: string): string {
  const text = singleLine(value)
  const quoted = (v: string): string => `"${v.replace(/[\\"]/g, '\\$&')}"`
  if (isPlain(text)) return `${name}=${quoted(text)}`
  const fallback = text.replace(/[^\x20-\x7e]/g, '_')
  const encoded = [...encodeUtf8(text)]
    .map((byte) =>
      /[A-Za-z0-9!#$&+\-.^_`|~]/.test(String.fromCharCode(byte))
        ? String.fromCharCode(byte)
        : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
    )
    .join('')
  return `${name}=${quoted(fallback)};${CRLF}\t${name}*=UTF-8''${encoded}`
}

/** Base64 in lines of at most 76 characters, ended with CR LF, as a body is written. */
export function base64Lines(bytes: Uint8Array): string {
  const all = encodeBase64(bytes)
  const lines: string[] = []
  for (let at = 0; at < all.length; at += LINE) lines.push(all.slice(at, at + LINE))
  return lines.length === 0 ? '' : lines.join(CRLF) + CRLF
}

/**
 * Text as quoted-printable, RFC 2045: what is plain ASCII stays, what is not becomes `=` and two
 * hex digits, a space or tab at the end of a line is encoded too, since a mail system may strip it,
 * and a line is cut with `=` before it gets longer than 76. The result is 7-bit, which is what a
 * server that did not say it takes 8-bit text has to be given.
 */
export function quotedPrintable(text: string): string {
  const lines = text.split(/\r\n|\r|\n/)
  const out: string[] = []
  for (const source of lines) {
    const bytes = encodeUtf8(source)
    let line = ''
    const add = (token: string): void => {
      // One character is kept free for the `=` that marks a cut line.
      if (line.length + token.length > LINE - 1) {
        out.push(`${line}=`)
        line = ''
      }
      line += token
    }
    bytes.forEach((byte, index) => {
      const atEnd = index === bytes.length - 1
      const plain = (byte >= 33 && byte <= 126 && byte !== 61) || ((byte === 32 || byte === 9) && !atEnd)
      add(plain ? String.fromCharCode(byte) : `=${byte.toString(16).toUpperCase().padStart(2, '0')}`)
    })
    out.push(line)
  }
  return out.join(CRLF)
}
