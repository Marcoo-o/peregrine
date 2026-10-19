import { describe, expect, it } from 'vitest'
import { loadTranscript, serverBytes } from '../test-support/fixtures'
import { parseResponse, ProtocolError, ResponseReader, tokenText, type ServerMessage } from './protocol'
import { decodeAscii } from './utf8'

const ascii = (text: string): Uint8Array => Uint8Array.from(text, (c) => c.charCodeAt(0))

function readAll(bytes: Uint8Array, chunkSize: number): Uint8Array[] {
  const reader = new ResponseReader()
  const out: Uint8Array[] = []
  for (let i = 0; i < bytes.length; i += chunkSize) {
    out.push(...reader.push(bytes.subarray(i, i + chunkSize)))
  }
  expect(reader.pending).toBe(0)
  return out
}

const transcripts = ['02-fetch', '03-mailboxes', '04-mutations', '07-starttls']

describe('ResponseReader', () => {
  it('splits a stream at line breaks', () => {
    const responses = readAll(ascii('* OK hello\r\nA1 OK done\r\n'), 1000)
    expect(responses.map((r) => decodeAscii(r))).toEqual(['* OK hello\r\n', 'A1 OK done\r\n'])
  })

  it('keeps a literal, line breaks and all, inside its response', () => {
    const [response, ...rest] = readAll(
      ascii('* 1 FETCH (BODY[] {12}\r\nline1\r\nline2)\r\nA1 OK done\r\n'),
      1000
    )
    expect(decodeAscii(response)).toBe('* 1 FETCH (BODY[] {12}\r\nline1\r\nline2)\r\n')
    expect(rest).toHaveLength(1)
  })

  // The literal's content is taken by count. It may look like anything, including the end of a
  // response and the start of the next one.
  it('does not read a literal as protocol', () => {
    const trap = '* OK fake\r\n{99}\r\n'
    const response = `* 1 FETCH (BODY[] {${trap.length}}\r\n${trap})\r\n`
    const responses = readAll(ascii(response + 'A1 OK done\r\n'), 1000)
    expect(responses.map((r) => decodeAscii(r))).toEqual([response, 'A1 OK done\r\n'])
  })

  it('handles a literal inside a list followed by more of the same line', () => {
    const response = '* 6 FETCH (ENVELOPE ("date" {5}\r\nhello (({3}\r\nabc NIL "a" "b")) NIL))\r\n'
    expect(readAll(ascii(response), 1000).map((r) => decodeAscii(r))).toEqual([response])
  })

  it('gives the same answer however the bytes are chunked', () => {
    for (const name of transcripts) {
      const bytes = serverBytes(name)
      const whole = readAll(bytes, bytes.length).map((r) => decodeAscii(r))
      expect(whole.length).toBeGreaterThan(5)
      // One byte at a time cuts every CRLF, every literal marker and every literal in two.
      expect(readAll(bytes, 1).map((r) => decodeAscii(r))).toEqual(whole)
      expect(readAll(bytes, 7).map((r) => decodeAscii(r))).toEqual(whole)
      expect(readAll(bytes, 64).map((r) => decodeAscii(r))).toEqual(whole)
    }
  })

  it('waits for the rest instead of guessing', () => {
    const reader = new ResponseReader()
    expect(reader.push(ascii('* OK partial'))).toEqual([])
    expect(reader.pending).toBeGreaterThan(0)
    expect(reader.push(ascii(' line\r')).length).toBe(0)
    expect(reader.push(ascii('\n')).length).toBe(1)
  })

  it('refuses a literal that would not fit in memory', () => {
    const reader = new ResponseReader()
    expect(() => reader.push(ascii('* 1 FETCH (BODY[] {4000000000}\r\n'))).toThrow(ProtocolError)
  })
})

describe('parseResponse', () => {
  const parse = (text: string): ServerMessage => parseResponse(ascii(text))

  it('reads a continuation', () => {
    expect(parse('+ idling\r\n')).toEqual({ kind: 'continuation', text: 'idling' })
    expect(parse('+ \r\n')).toEqual({ kind: 'continuation', text: '' })
  })

  it('reads a tagged status with and without a code', () => {
    expect(parse('A2 NO [AUTHENTICATIONFAILED] Authentication failed.\r\n')).toMatchObject({
      kind: 'status',
      tag: 'A2',
      status: 'NO',
      code: { name: 'AUTHENTICATIONFAILED', args: [] },
      text: 'Authentication failed.'
    })
    expect(parse('A9 OK Logout completed (0.001 + 0.000 secs).\r\n')).toMatchObject({
      tag: 'A9',
      status: 'OK',
      code: null,
      text: 'Logout completed (0.001 + 0.000 secs).'
    })
  })

  it('reads the data a code carries', () => {
    const copy = parse('* OK [COPYUID 1792357328 3:4 1:2] Moved UIDs.\r\n')
    expect(copy).toMatchObject({ tag: null, status: 'OK', code: { name: 'COPYUID' } })
    if (copy.kind === 'status') {
      expect(copy.code?.args.map(tokenText)).toEqual(['1792357328', '3:4', '1:2'])
    }
    const flags = parse('* OK [PERMANENTFLAGS (\\Answered \\Flagged \\*)] Flags permitted.\r\n')
    if (flags.kind === 'status') {
      expect(flags.code?.args[0]).toEqual({
        type: 'list',
        items: [
          { type: 'atom', value: '\\Answered' },
          { type: 'atom', value: '\\Flagged' },
          { type: 'atom', value: '\\*' }
        ]
      })
    }
  })

  it('reads a response code that is a single word', () => {
    expect(parse('* OK [CLOSED] Previous mailbox closed.\r\n')).toMatchObject({
      code: { name: 'CLOSED', args: [] },
      text: 'Previous mailbox closed.'
    })
  })

  it('reads data with and without a number in front', () => {
    expect(parse('* 9 EXISTS\r\n')).toEqual({ kind: 'data', name: 'EXISTS', number: 9, tokens: [] })
    expect(parse('* CAPABILITY IMAP4rev1 IDLE\r\n')).toMatchObject({
      name: 'CAPABILITY',
      number: null,
      tokens: [
        { type: 'atom', value: 'IMAP4rev1' },
        { type: 'atom', value: 'IDLE' }
      ]
    })
  })

  it('tells the kinds of string and NIL apart', () => {
    const message = parse('* LIST (\\Noselect) NIL "" Drafts\r\n')
    if (message.kind !== 'data') throw new Error('not data')
    expect(message.tokens.map((t) => t.type)).toEqual(['list', 'nil', 'string', 'atom'])
  })

  it('unescapes a quoted string', () => {
    const message = parse('* LIST () "/" "say \\"hi\\" \\\\ now"\r\n')
    if (message.kind !== 'data') throw new Error('not data')
    expect(tokenText(message.tokens[2])).toBe('say "hi" \\ now')
  })

  it('reads a literal as bytes, UTF-8 included', () => {
    const bytes = Uint8Array.from([
      ...ascii('* LIST () "/" {7}\r\n'),
      0x47, 0x72, 0xc3, 0xbc, 0xc3, 0x9f, 0x65, 0x0d, 0x0a
    ])
    const message = parseResponse(bytes)
    if (message.kind !== 'data') throw new Error('not data')
    expect(tokenText(message.tokens[2])).toBe('Grüße')
  })

  it('keeps a section with its spaces as one item', () => {
    const message = parse('* 1 FETCH (BODY[HEADER.FIELDS (DATE FROM)]<0> {3}\r\nabc)\r\n')
    if (message.kind !== 'data' || message.tokens[0].type !== 'list') throw new Error('shape')
    expect(message.tokens[0].items[0]).toEqual({
      type: 'atom',
      value: 'BODY[HEADER.FIELDS (DATE FROM)]<0>'
    })
  })

  it('turns whole numbers into numbers and keeps the rest as atoms', () => {
    const message = parse('* STATUS INBOX (MESSAGES 9 UIDVALIDITY 1792357320)\r\n')
    if (message.kind !== 'data' || message.tokens[1].type !== 'list') throw new Error('shape')
    expect(message.tokens[1].items).toEqual([
      { type: 'atom', value: 'MESSAGES' },
      { type: 'number', value: 9 },
      { type: 'atom', value: 'UIDVALIDITY' },
      { type: 'number', value: 1792357320 }
    ])
  })

  it('refuses what is not a response', () => {
    expect(() => parse('garbage without a status\r\n')).toThrow(ProtocolError)
    expect(() => parse('* LIST (unclosed\r\n')).toThrow(ProtocolError)
    expect(() => parse('* LIST "unclosed\r\n')).toThrow(ProtocolError)
    expect(() => parse('* 1 FETCH (BODY[] {10}\r\nshort)\r\n')).toThrow(ProtocolError)
  })
})

describe('recorded conversations', () => {
  const parsedFrom = (name: string): ServerMessage[] => readAll(serverBytes(name), 1000).map(parseResponse)

  it('parse from the first byte to the last', () => {
    for (const name of transcripts) expect(parsedFrom(name).length).toBeGreaterThan(5)
  })

  it('answer every command they sent', () => {
    for (const name of transcripts) {
      const sent = loadTranscript(name)
        .filter((e) => e.direction === 'C')
        .map((e) => decodeAscii(e.bytes).split(' ')[0])
        .filter((tag) => /^A\d+$/.test(tag))
      const answered = parsedFrom(name).map((m) => (m.kind === 'status' ? m.tag : null))
      for (const tag of sent) expect(answered).toContain(tag)
    }
  })

  it('read the greeting of the server with what it can do', () => {
    const [greeting] = parsedFrom('07-starttls')
    expect(greeting).toMatchObject({ kind: 'status', tag: null, status: 'OK', code: { name: 'CAPABILITY' } })
    if (greeting.kind === 'status') {
      expect(greeting.code?.args.map(tokenText)).toContain('STARTTLS')
    }
  })
})
