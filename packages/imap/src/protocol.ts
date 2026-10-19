import { decodeAscii, decodeUtf8 } from './utf8'

/**
 * The server's side of the conversation, turned into values.
 *
 * Two stages. `ResponseReader` finds where one response ends in the stream of bytes, which is
 * less obvious than it sounds: a response can contain literals, whose length is announced in
 * braces and whose content may include anything, line breaks included. `parseResponse` then reads
 * one complete response.
 *
 * Everything works on bytes, not text. A literal can be a message of several megabytes, and a
 * header can be raw UTF-8 or something older, so nothing is decoded until a caller asks for it.
 */

export type Token =
  | { type: 'atom'; value: string }
  | { type: 'number'; value: number }
  | { type: 'string'; bytes: Uint8Array }
  | { type: 'nil' }
  | { type: 'list'; items: Token[] }

export type StatusKind = 'OK' | 'NO' | 'BAD' | 'BYE' | 'PREAUTH'

export interface ResponseCode {
  name: string
  args: Token[]
}

export type ServerMessage =
  | { kind: 'continuation'; text: string }
  | {
      kind: 'status'
      /** The tag the answer belongs to, or null for an untagged status. */
      tag: string | null
      status: StatusKind
      code: ResponseCode | null
      text: string
    }
  | {
      kind: 'data'
      /** Upper case keyword, such as LIST, FETCH, EXISTS or CAPABILITY. */
      name: string
      /** The number that comes before the keyword in `* 3 EXISTS` and `* 3 FETCH (…)`. */
      number: number | null
      tokens: Token[]
    }

export class ProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProtocolError'
  }
}

const CR = 0x0d
const LF = 0x0a
const SPACE = 0x20
const QUOTE = 0x22
const LPAREN = 0x28
const RPAREN = 0x29
const LBRACE = 0x7b
const RBRACE = 0x7d
const LBRACKET = 0x5b
const RBRACKET = 0x5d
const BACKSLASH = 0x5c
const PLUS = 0x2b
const STAR = 0x2a
const ZERO = 0x30
const NINE = 0x39

/** A very large announced literal is refused instead of waited for. */
const MAX_LITERAL = 512 * 1024 * 1024

/**
 * Cuts a stream of bytes into complete responses.
 *
 * A response ends at a line break unless that line ends in `{n}`, in which case the next n bytes
 * belong to it whatever they contain, and the response goes on after them. The bytes of a literal
 * are skipped by count, never looked at, so a large message costs a copy and not a scan.
 */
export class ResponseReader {
  private buffer = new Uint8Array(4096)
  private length = 0
  /** Where the response being read starts. */
  private start = 0
  /** How far scanning has got. */
  private position = 0
  private literalRemaining = 0

  push(chunk: Uint8Array): Uint8Array[] {
    this.append(chunk)
    const complete: Uint8Array[] = []

    for (;;) {
      if (this.literalRemaining > 0) {
        const take = Math.min(this.literalRemaining, this.length - this.position)
        this.position += take
        this.literalRemaining -= take
        if (this.literalRemaining > 0) break
      }

      const lineEnd = this.findLineEnd()
      if (lineEnd === -1) break

      const announced = this.literalAnnouncedBefore(lineEnd)
      if (announced !== null) {
        if (announced > MAX_LITERAL) throw new ProtocolError(`Literal of ${announced} bytes refused`)
        this.position = lineEnd + 2
        this.literalRemaining = announced
        continue
      }

      // A copy, because the buffer is reused for what comes next and the parsed values keep views
      // into what they were given.
      complete.push(this.buffer.slice(this.start, lineEnd + 2))
      this.start = lineEnd + 2
      this.position = this.start
    }

    this.compact()
    return complete
  }

  /** Bytes received that do not yet make a complete response. */
  get pending(): number {
    return this.length - this.start
  }

  private append(chunk: Uint8Array): void {
    const needed = this.length + chunk.length
    if (needed > this.buffer.length) {
      let capacity = this.buffer.length
      while (capacity < needed) capacity *= 2
      const grown = new Uint8Array(capacity)
      grown.set(this.buffer.subarray(0, this.length))
      this.buffer = grown
    }
    this.buffer.set(chunk, this.length)
    this.length = needed
  }

  /** Index of the CR of the next CRLF at or after the scan position, or -1. */
  private findLineEnd(): number {
    for (let i = this.position; i < this.length - 1; i++) {
      if (this.buffer[i] === CR && this.buffer[i + 1] === LF) return i
    }
    // Resume at the last byte, which may be the CR of a CRLF cut in two by the chunking.
    this.position = Math.max(this.position, this.length - 1)
    return -1
  }

  private literalAnnouncedBefore(lineEnd: number): number | null {
    let i = lineEnd - 1
    if (this.buffer[i] !== RBRACE) return null
    i--
    if (this.buffer[i] === PLUS) i--
    let digits = 0
    let value = 0
    while (i >= this.start && this.buffer[i] >= ZERO && this.buffer[i] <= NINE) {
      value += (this.buffer[i] - ZERO) * 10 ** digits
      digits++
      i--
    }
    if (digits === 0 || i < this.start || this.buffer[i] !== LBRACE) return null
    return value
  }

  private compact(): void {
    if (this.start === 0) return
    this.buffer.copyWithin(0, this.start, this.length)
    this.length -= this.start
    this.position -= this.start
    this.start = 0
  }
}

class Cursor {
  position = 0
  constructor(readonly bytes: Uint8Array) {}

  get done(): boolean {
    return this.position >= this.bytes.length
  }

  peek(): number {
    return this.bytes[this.position]
  }
}

function isLineEnd(byte: number): boolean {
  return byte === CR || byte === LF
}

function skipSpaces(cursor: Cursor): void {
  while (!cursor.done && cursor.peek() === SPACE) cursor.position++
}

function readQuoted(cursor: Cursor): Token {
  cursor.position++ // the opening quote
  const out: number[] = []
  for (;;) {
    if (cursor.done) throw new ProtocolError('Quoted string is not closed')
    const byte = cursor.bytes[cursor.position++]
    if (byte === QUOTE) break
    if (byte === BACKSLASH) {
      if (cursor.done) throw new ProtocolError('Quoted string ends in a backslash')
      out.push(cursor.bytes[cursor.position++])
    } else {
      out.push(byte)
    }
  }
  return { type: 'string', bytes: Uint8Array.from(out) }
}

function readLiteral(cursor: Cursor): Token {
  cursor.position++ // the brace
  let size = 0
  let digits = 0
  while (!cursor.done && cursor.peek() >= ZERO && cursor.peek() <= NINE) {
    size = size * 10 + (cursor.bytes[cursor.position++] - ZERO)
    digits++
  }
  if (digits === 0) throw new ProtocolError('Literal without a length')
  if (!cursor.done && cursor.peek() === PLUS) cursor.position++
  if (cursor.done || cursor.bytes[cursor.position++] !== RBRACE) {
    throw new ProtocolError('Literal length is not closed')
  }
  if (cursor.bytes[cursor.position] !== CR || cursor.bytes[cursor.position + 1] !== LF) {
    throw new ProtocolError('Literal length is not followed by a line break')
  }
  cursor.position += 2
  const end = cursor.position + size
  if (end > cursor.bytes.length) throw new ProtocolError('Literal is shorter than announced')
  const bytes = cursor.bytes.subarray(cursor.position, end)
  cursor.position = end
  return { type: 'string', bytes }
}

/**
 * Reads an atom. Section brackets are part of it where they follow a name, so that
 * `BODY[HEADER.FIELDS (DATE FROM)]<0>` is one item as the protocol means it, spaces and all. In a
 * response code a closing bracket ends the atom instead.
 */
function readAtom(cursor: Cursor, inCode: boolean): Token {
  const start = cursor.position
  while (!cursor.done) {
    const byte = cursor.peek()
    if (byte === SPACE || byte === LPAREN || byte === RPAREN || isLineEnd(byte)) break
    if (byte === RBRACKET && inCode) break
    if (byte === LBRACKET && cursor.position > start) {
      // Through the matching bracket, quoted strings and all.
      cursor.position++
      while (!cursor.done && cursor.peek() !== RBRACKET) {
        if (cursor.peek() === QUOTE) readQuoted(cursor)
        else cursor.position++
      }
      if (cursor.done) throw new ProtocolError('Section is not closed')
      cursor.position++
      continue
    }
    cursor.position++
  }
  if (cursor.position === start) throw new ProtocolError(`Unexpected byte ${cursor.peek()} at ${start}`)
  const value = decodeAscii(cursor.bytes, start, cursor.position)
  if (/^\d{1,15}$/.test(value)) return { type: 'number', value: Number(value) }
  if (value.length === 3 && value.toUpperCase() === 'NIL') return { type: 'nil' }
  return { type: 'atom', value }
}

function readToken(cursor: Cursor, inCode: boolean): Token {
  const byte = cursor.peek()
  if (byte === QUOTE) return readQuoted(cursor)
  if (byte === LBRACE) return readLiteral(cursor)
  if (byte === LPAREN) {
    cursor.position++
    const items: Token[] = []
    for (;;) {
      skipSpaces(cursor)
      if (cursor.done || isLineEnd(cursor.peek())) throw new ProtocolError('List is not closed')
      if (cursor.peek() === RPAREN) {
        cursor.position++
        return { type: 'list', items }
      }
      items.push(readToken(cursor, false))
    }
  }
  return readAtom(cursor, inCode)
}

function readTokens(cursor: Cursor, stopAtBracket: boolean): Token[] {
  const tokens: Token[] = []
  for (;;) {
    skipSpaces(cursor)
    if (cursor.done || isLineEnd(cursor.peek())) break
    if (stopAtBracket && cursor.peek() === RBRACKET) break
    tokens.push(readToken(cursor, stopAtBracket))
  }
  return tokens
}

function readWord(cursor: Cursor): string {
  const start = cursor.position
  while (!cursor.done && cursor.peek() !== SPACE && !isLineEnd(cursor.peek())) cursor.position++
  return decodeAscii(cursor.bytes, start, cursor.position)
}

function readRestOfLine(cursor: Cursor): string {
  const start = cursor.position
  while (!cursor.done && !isLineEnd(cursor.peek())) cursor.position++
  return decodeUtf8(cursor.bytes.subarray(start, cursor.position))
}

const STATUSES = new Set(['OK', 'NO', 'BAD', 'BYE', 'PREAUTH'])

function readStatus(cursor: Cursor, tag: string | null, status: StatusKind): ServerMessage {
  skipSpaces(cursor)
  let code: ResponseCode | null = null
  if (!cursor.done && cursor.peek() === LBRACKET) {
    cursor.position++
    const items = readTokens(cursor, true)
    if (cursor.done || cursor.peek() !== RBRACKET) throw new ProtocolError('Response code is not closed')
    cursor.position++
    const [name, ...args] = items
    if (!name) throw new ProtocolError('Empty response code')
    code = { name: tokenText(name).toUpperCase(), args }
    skipSpaces(cursor)
  }
  return { kind: 'status', tag, status, code, text: readRestOfLine(cursor) }
}

/** Reads one complete response, line break and literals included. */
export function parseResponse(bytes: Uint8Array): ServerMessage {
  const cursor = new Cursor(bytes)
  if (cursor.done) throw new ProtocolError('Empty response')

  if (cursor.peek() === PLUS) {
    cursor.position++
    skipSpaces(cursor)
    return { kind: 'continuation', text: readRestOfLine(cursor) }
  }

  if (cursor.peek() === STAR) {
    cursor.position++
    skipSpaces(cursor)
    let number: number | null = null
    const first = readWord(cursor)
    let keyword = first.toUpperCase()
    if (/^\d+$/.test(first)) {
      number = Number(first)
      skipSpaces(cursor)
      keyword = readWord(cursor).toUpperCase()
    }
    if (number === null && STATUSES.has(keyword)) {
      return readStatus(cursor, null, keyword as StatusKind)
    }
    if (!keyword) throw new ProtocolError('Untagged response without a keyword')
    return { kind: 'data', name: keyword, number, tokens: readTokens(cursor, false) }
  }

  const tag = readWord(cursor)
  skipSpaces(cursor)
  const status = readWord(cursor).toUpperCase()
  if (!tag || !STATUSES.has(status)) {
    throw new ProtocolError(`Not a response: ${decodeAscii(bytes, 0, Math.min(bytes.length, 60))}`)
  }
  return readStatus(cursor, tag, status as StatusKind)
}

/** The text of a token, whatever kind it is, or null for NIL and lists. */
export function tokenText(token: Token | undefined): string {
  if (!token) return ''
  switch (token.type) {
    case 'atom':
      return token.value
    case 'number':
      return String(token.value)
    case 'string':
      return decodeUtf8(token.bytes)
    default:
      return ''
  }
}
