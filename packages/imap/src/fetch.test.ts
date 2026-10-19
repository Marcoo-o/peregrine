import { describe, expect, it } from 'vitest'
import { serverBytes } from '../test-support/fixtures'
import { parseBodyStructure, parseEnvelope, parseFetch, type FetchData } from './fetch'
import { decodeBase64, decodeCharset, decodeMimeWords, encodeBase64 } from './mime'
import { parseResponse, ResponseReader } from './protocol'
import { decodeUtf8, encodeUtf8 } from './utf8'

/** The messages the corpus was built from, as the server numbered them: UID 1 to 9. */
function fetched(): Map<number, FetchData> {
  const reader = new ResponseReader()
  const out = new Map<number, FetchData>()
  for (const raw of reader.push(serverBytes('02-fetch'))) {
    const message = parseResponse(raw)
    if (message.kind === 'data' && message.name === 'FETCH') {
      const data = parseFetch(message)
      // The full fetch carries the envelope. The flags-only and body fetches that follow do not.
      if (data.uid !== undefined && data.envelope) out.set(data.uid, data)
    }
  }
  return out
}

describe('RFC 2047 words', () => {
  it('decodes B and Q words', () => {
    expect(decodeMimeWords('=?UTF-8?B?R3LDvMOfZSBhdXMgTcO8bmNoZW4g4pyT?=')).toBe('Grüße aus München ✓')
    expect(decodeMimeWords('=?UTF-8?Q?M=C3=BCller=2C_Hans?=')).toBe('Müller, Hans')
  })

  it('decodes other charsets', () => {
    expect(decodeMimeWords('=?ISO-8859-1?Q?Gr=FC=DFe?=')).toBe('Grüße')
    expect(decodeMimeWords('=?windows-1252?Q?=80_5_=96_=93quoted=94?=')).toBe('€ 5 – “quoted”')
    expect(decodeMimeWords('=?ISO-8859-15?Q?=A4_5?=')).toBe('€ 5')
  })

  // Through the platform's decoder, since there is no table for it here.
  it('asks the platform for a charset it has no table for', () => {
    expect(decodeMimeWords('=?Shift_JIS?B?k/qWe4zq?=')).toBe('日本語')
  })

  it('drops the space between two words and keeps the text around them', () => {
    expect(decodeMimeWords('Re: =?UTF-8?Q?Gr=C3=BC?= =?UTF-8?Q?=C3=9Fe?= (alt)')).toBe('Re: Grüße (alt)')
    expect(decodeMimeWords('a =?UTF-8?Q?b?= c')).toBe('a b c')
  })

  // Some software cuts a multi byte character in two across words. Each half alone is invalid.
  it('joins words of one charset before decoding them', () => {
    expect(decodeMimeWords('=?UTF-8?B?w7w=?= =?UTF-8?B?w7w=?=')).toBe('üü')
    expect(decodeMimeWords('=?UTF-8?Q?=C3?= =?UTF-8?Q?=BC?=')).toBe('ü')
  })

  it('leaves plain text and malformed words alone', () => {
    expect(decodeMimeWords('Hello world')).toBe('Hello world')
    expect(decodeMimeWords('=?UTF-8?X?abc?=')).toBe('=?UTF-8?X?abc?=')
    expect(decodeMimeWords('=?broken')).toBe('=?broken')
  })

  it('ignores a language tag on the charset', () => {
    expect(decodeCharset('utf-8*en', encodeUtf8('ü'))).toBe('ü')
  })
})

describe('base64', () => {
  it('goes both ways, with and without padding', () => {
    for (const text of ['', 'f', 'fo', 'foo', 'foob', 'Grüße ✓ 😀']) {
      const bytes = encodeUtf8(text)
      expect(encodeBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'))
      expect(decodeUtf8(decodeBase64(encodeBase64(bytes)))).toBe(text)
    }
  })

  it('skips line breaks and stray characters', () => {
    expect(decodeUtf8(decodeBase64('Zm9v\r\nYmFy'))).toBe('foobar')
  })
})

describe('the envelopes the server sent', () => {
  const messages = fetched()
  const envelope = (uid: number) => messages.get(uid)?.envelope

  it('has all nine messages of the corpus', () => {
    expect([...messages.keys()]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('reads a plain one', () => {
    expect(envelope(1)).toEqual({
      date: 'Mon, 05 Jan 2026 10:00:00 +0000',
      subject: 'Hello plain',
      from: [{ name: 'Alice Example', address: 'alice@example.com' }],
      sender: [{ name: 'Alice Example', address: 'alice@example.com' }],
      replyTo: [{ name: 'Alice Example', address: 'alice@example.com' }],
      to: [{ address: 'test@example.com' }],
      cc: [],
      bcc: [],
      inReplyTo: null,
      messageId: '<m1@example.com>'
    })
  })

  it('decodes encoded words in the subject and in every name', () => {
    const e = envelope(3)!
    expect(e.subject).toBe('Grüße aus München ✓')
    expect(e.from).toEqual([{ name: 'Müller, Hans', address: 'hans@example.de' }])
    expect(e.cc).toEqual([{ name: '日本語 テスト', address: 'jp@example.jp' }])
    expect(e.replyTo).toEqual([{ name: 'Hans', address: 'reply@example.de' }])
    expect(e.inReplyTo).toBe('<m1@example.com>')
  })

  // `Team: a@example.com, "B Person" <b@example.com>;` and an empty group are on the wire as
  // markers between the members. The members are people and have to survive, the group names do
  // not stand for anyone.
  it('keeps the members of an address group and drops the markers', () => {
    expect(envelope(3)!.to).toEqual([
      { name: 'Grüße', address: 'gruesse@example.de' },
      { address: 'a@example.com' },
      { name: 'B Person', address: 'b@example.com' }
    ])
  })

  it('copes with a message that has hardly any headers', () => {
    expect(envelope(5)).toEqual({
      date: null,
      subject: null,
      from: [{ address: 'nobody@example.com' }],
      sender: [{ address: 'nobody@example.com' }],
      replyTo: [{ address: 'nobody@example.com' }],
      to: [],
      cc: [],
      bcc: [],
      inReplyTo: null,
      messageId: null
    })
  })

  // Dovecot sends a header that holds raw UTF-8 as a literal in the middle of the envelope.
  it('reads raw UTF-8 headers sent as literals', () => {
    const e = envelope(6)!
    expect(e.subject).toBe('Grüße direkt im Header')
    expect(e.from).toEqual([{ name: 'Jörg Müller', address: 'joerg@example.de' }])
  })

  it('reads a folded subject with quotes and backslashes in it', () => {
    const e = envelope(7)!
    expect(e.subject).toBe(
      'A very long subject line that has to be folded over several lines because the sender\'s client wrapped it at seventy-eight columns, and it also says "hi" \\ there'
    )
    expect(e.from[0].name).toBe('Quote "Man" Back\\slash')
  })

  it('reads flags, size and uid', () => {
    expect(messages.get(2)).toMatchObject({ uid: 2, flags: ['\\Seen'], size: 522 })
  })

  it('refuses a list that is not an envelope', () => {
    expect(() => parseEnvelope({ type: 'list', items: [] })).toThrow(/ten fields/)
    expect(() => parseEnvelope(undefined)).toThrow(/ten fields/)
  })
})

describe('the body structures the server sent', () => {
  const messages = fetched()
  const structure = (uid: number) => messages.get(uid)!.bodyStructure!
  const dispositions = (uid: number) => structure(uid).childNodes?.map((n) => n.disposition)

  it('reads a single part', () => {
    expect(structure(1)).toMatchObject({
      type: 'text',
      subtype: 'plain',
      parameters: { charset: 'us-ascii' },
      encoding: '7bit',
      size: 14,
      disposition: null
    })
    expect(structure(1).childNodes).toBeUndefined()
  })

  it('reads a multipart with an attachment', () => {
    expect(structure(2)).toMatchObject({ type: 'multipart', subtype: 'mixed', parameters: { boundary: 'BOUNDARY2' } })
    expect(structure(2).childNodes).toHaveLength(2)
    expect(structure(2).childNodes![1]).toMatchObject({
      type: 'application',
      subtype: 'pdf',
      encoding: 'base64',
      size: 28,
      disposition: 'attachment',
      dispositionParameters: { filename: 'invoice.pdf' }
    })
    expect(dispositions(2)).toEqual([null, 'attachment'])
  })

  it('tells inline from attachment', () => {
    expect(dispositions(8)).toEqual([null, 'inline', 'attachment'])
  })

  it('keeps a parameter with an extended name as the server wrote it', () => {
    expect(structure(8).childNodes![2].dispositionParameters).toEqual({
      'filename*': "UTF-8''gr%C3%BC%C3%9Fe.pdf"
    })
  })

  it('reads nested multiparts down to the part inside', () => {
    expect(dispositions(4)).toEqual([null, null])
    const [alternative, inner] = structure(4).childNodes!
    expect(alternative.subtype).toBe('alternative')
    expect(alternative.childNodes!.map((n) => n.subtype)).toEqual(['plain', 'html'])
    expect(inner.childNodes![0].disposition).toBe('attachment')
  })

  it('reads an embedded message with its own envelope and structure', () => {
    const embedded = structure(9).childNodes![1]
    expect(embedded).toMatchObject({ type: 'message', subtype: 'rfc822', disposition: 'attachment' })
    expect(embedded.dispositionParameters).toEqual({ filename: 'original.eml' })
    expect(embedded.envelope).toMatchObject({
      subject: 'The original',
      from: [{ name: 'Frank', address: 'frank@example.com' }]
    })
    expect(embedded.childNodes![0]).toMatchObject({ type: 'multipart', subtype: 'alternative' })
  })

  it('refuses something that is not a structure', () => {
    expect(() => parseBodyStructure({ type: 'nil' })).toThrow(/not a list/)
  })
})

describe('FETCH data items in whatever order they come', () => {
  const parse = (text: string) => {
    const bytes = Uint8Array.from(text, (c) => c.charCodeAt(0))
    return parseFetch(parseResponse(bytes))
  }

  it('reads a body section as bytes', () => {
    const data = parse('* 1 FETCH (UID 1 BODY[] {5}\r\nhello)\r\n')
    expect(data.uid).toBe(1)
    expect(decodeUtf8(data.sections.get('BODY[]')!)).toBe('hello')
  })

  it('does not mind the order', () => {
    const data = parse('* 3 FETCH (FLAGS (\\Seen $x) UID 12 RFC822.SIZE 99)\r\n')
    expect(data).toMatchObject({ sequence: 3, uid: 12, flags: ['\\Seen', '$x'], size: 99 })
  })

  it('treats a NIL section as absent', () => {
    expect(parse('* 1 FETCH (UID 1 BODY[] NIL)\r\n').sections.size).toBe(0)
  })
})
