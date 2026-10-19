import { describe, expect, it } from 'vitest'
import { decodeBase64, decodeMimeWords } from '@peregrine/imap/mime'
import { composeMessage, type ComposeInput } from './compose'
import { SmtpError } from './errors'
import { encodeText, formatAddress, parameter, parseAddress, quotedPrintable } from './headers'

const text = (bytes: Uint8Array): string => String.fromCharCode(...bytes)
const fixed = { now: new Date(Date.UTC(2026, 9, 19, 10, 5, 7)), random: () => 0.5 }

const base: ComposeInput = {
  from: 'alex@example.org',
  to: ['anna@example.net'],
  subject: 'Hello',
  text: 'Good day\r\n'
}

function compose(over: Partial<ComposeInput> = {}) {
  return composeMessage({ ...base, ...over }, fixed)
}

/** The header section and the body, the headers unfolded and by name. */
function split(source: Uint8Array) {
  const all = text(source)
  const end = all.indexOf('\r\n\r\n')
  const unfolded = all.slice(0, end).replace(/\r\n[ \t]+/g, ' ')
  const headers = new Map<string, string>()
  for (const line of unfolded.split('\r\n')) {
    const colon = line.indexOf(':')
    headers.set(line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim())
  }
  return { raw: all.slice(0, end), headers, body: all.slice(end + 4), all }
}

/** A reader for quoted-printable that shares nothing with the writer, so that they can disagree. */
function decodeQuotedPrintable(input: string): string {
  const joined = input.replace(/=\r\n/g, '')
  const bytes: number[] = []
  for (let i = 0; i < joined.length; i++) {
    if (joined[i] === '=') {
      bytes.push(parseInt(joined.slice(i + 1, i + 3), 16))
      i += 2
    } else bytes.push(joined.charCodeAt(i))
  }
  return new TextDecoder().decode(Uint8Array.from(bytes))
}

describe('the headers of a message', () => {
  it('has the headers a reader expects, in plain ASCII', () => {
    const { headers } = split(compose().source)
    expect(headers.get('from')).toBe('alex@example.org')
    expect(headers.get('to')).toBe('anna@example.net')
    expect(headers.get('subject')).toBe('Hello')
    expect(headers.get('date')).toBe('Mon, 19 Oct 2026 10:05:07 +0000')
    expect(headers.get('mime-version')).toBe('1.0')
    expect(headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(headers.get('content-transfer-encoding')).toBe('7bit')
  })

  it('gives the message an id in the domain of the sender', () => {
    const composed = compose()
    expect(composed.messageId).toMatch(/^<[a-z0-9]+\.[a-z0-9]{12}@example\.org>$/)
    expect(split(composed.source).headers.get('message-id')).toBe(composed.messageId)
  })

  it('gives two messages two ids', () => {
    const a = composeMessage(base)
    const b = composeMessage(base)
    expect(a.messageId).not.toBe(b.messageId)
  })

  it('writes what a message answers, and the thread it is in', () => {
    const { headers } = split(compose({ inReplyTo: '<one@example.net>', references: ['<zero@example.net>', '<one@example.net>'] }).source)
    expect(headers.get('in-reply-to')).toBe('<one@example.net>')
    expect(headers.get('references')).toBe('<zero@example.net> <one@example.net>')
  })

  it('takes references written as one string, and refuses what is not a message id', () => {
    expect(split(compose({ references: '<a@x.example> <b@x.example>' }).source).headers.get('references')).toBe('<a@x.example> <b@x.example>')
    expect(() => compose({ inReplyTo: 'one@example.net' })).toThrow(SmtpError)
    // one that carries a header is refused, not cleaned up: the part after the break is no id
    expect(() => compose({ references: ['<a@x.example>\r\nBcc: spy@example.org'] })).toThrow(SmtpError)
    expect(() => compose({ inReplyTo: '<a@x.example>\r\nBcc: spy@example.org' })).toThrow(SmtpError)
  })

  it('writes the display name of an address, quoted where it needs to be', () => {
    const { headers } = split(compose({ from: { name: 'Alex Beispiel', address: 'alex@example.org' }, to: ['"Müller, Anna" <anna@example.net>', 'Bert Q. Public <bert@example.com>'] }).source)
    expect(headers.get('from')).toBe('Alex Beispiel <alex@example.org>')
    expect(decodeMimeWords(headers.get('to') as string)).toBe('Müller, Anna <anna@example.net>, "Bert Q. Public" <bert@example.com>'.replace('"Bert Q. Public"', '"Bert Q. Public"'))
  })

  it('splits an address written as a name and an address', () => {
    expect(parseAddress('Anna <anna@example.net>')).toEqual({ name: 'Anna', address: 'anna@example.net' })
    expect(parseAddress('"Anna \\"A\\" B" <anna@example.net>')).toEqual({ name: 'Anna "A" B', address: 'anna@example.net' })
    expect(parseAddress('anna@example.net')).toEqual({ address: 'anna@example.net' })
    expect(parseAddress('<anna@example.net>')).toEqual({ address: 'anna@example.net' })
  })

  it('writes the quote and the backslash of a name so that they stay in the name', () => {
    expect(formatAddress({ name: 'A "B" \\ C', address: 'a@example.net' })).toBe('"A \\"B\\" \\\\ C" <a@example.net>')
  })

  it('keeps the blind copy out of the headers and puts it into the envelope', () => {
    const composed = compose({ to: ['anna@example.net'], cc: ['bert@example.com'], bcc: ['carl@example.org', 'anna@example.net'] })
    const shown = text(composed.source)
    expect(shown).not.toMatch(/carl@example\.org/)
    expect(shown).not.toMatch(/^bcc:/im)
    expect(split(composed.source).headers.get('cc')).toBe('bert@example.com')
    expect(composed.envelope).toEqual({ from: 'alex@example.org', to: ['anna@example.net', 'bert@example.com', 'carl@example.org'] })
  })

  it('writes a Reply-To when there is one', () => {
    expect(split(compose({ replyTo: 'office@example.org' }).source).headers.get('reply-to')).toBe('office@example.org')
  })

  it('is for somebody', () => {
    expect(() => compose({ to: [], cc: [], bcc: [] })).toThrow(/no recipient/)
    expect(() => compose({ to: [], bcc: ['carl@example.org'] })).not.toThrow()
  })
})

describe('what is refused or taken out of a header', () => {
  const evil = 'x\r\nBcc: spy@example.org\r\nX-Evil: 1'

  // A header ends at the first line break. A subject that has one would add a header, or end them.
  it('a line break in the subject does not add a header', () => {
    const { headers, raw } = split(compose({ subject: evil }).source)
    expect(headers.has('bcc')).toBe(false)
    expect(headers.has('x-evil')).toBe(false)
    expect(raw.split('\r\n').filter((line) => /^(bcc|x-evil):/i.test(line))).toEqual([])
    expect(decodeMimeWords(headers.get('subject') as string)).toBe('x Bcc: spy@example.org X-Evil: 1')
  })

  it('a line break that ends the headers and starts the body does not', () => {
    const composed = compose({ subject: 'one\r\n\r\ntwo' })
    const { headers, body } = split(composed.source)
    expect(headers.get('subject')).toBe('one two')
    expect(headers.get('mime-version')).toBe('1.0')
    expect(body).toBe('Good day\r\n')
  })

  it('a line break in a name does not add a header', () => {
    const { raw } = split(compose({ from: { name: 'Alex\r\nBcc: spy@example.org', address: 'alex@example.org' } }).source)
    expect(raw.split('\r\n').filter((line) => /^bcc:/i.test(line))).toEqual([])
  })

  it('an address that is not one', () => {
    for (const bad of ['', 'anna', 'anna@', '@example.net', 'a@b@c.example', 'a b@example.net', 'a@example.net\r\nBcc: x@y.example', 'a,b@example.net', 'jörg@example.net', '<<a@example.net>>']) {
      expect(() => compose({ to: [bad] }), bad).toThrow(SmtpError)
    }
    expect(() => compose({ from: 'nobody' })).toThrow(SmtpError)
  })

  it('a line break in a file name or a type does not add a header to the part', () => {
    const composed = compose({ attachments: [{ filename: 'a.txt\r\nX-Evil: 1', contentType: 'text/plain\r\nX-Evil: 2', content: Uint8Array.of(1, 2, 3) }] })
    expect(text(composed.source)).not.toMatch(/^x-evil:/im)
  })

  it('a file name with a path in it is the name alone', () => {
    const shown = text(compose({ attachments: [{ filename: '../../etc/passwd', content: Uint8Array.of(1) }] }).source)
    expect(shown).toContain('filename=".._.._etc_passwd"')
  })
})

describe('text in a header', () => {
  const roundTrip = (value: string): string => decodeMimeWords(encodeText(value).replace(/\r\n /g, ' '))

  it('leaves ASCII as it is', () => {
    expect(encodeText('Hello world')).toBe('Hello world')
  })

  it('encodes what is not ASCII so that a reader gets it back', () => {
    for (const value of ['Grüße aus München', 'Привет', '日本語のテキスト', 'smile 😀 and more', 'ä'.repeat(100), '😀'.repeat(40), 'x'.repeat(40) + 'ü' + 'y'.repeat(40)]) {
      expect(roundTrip(value), value).toBe(value)
    }
  })

  it('cuts an encoded word between characters, so that none is split', () => {
    const encoded = encodeText('😀'.repeat(40), 9)
    for (const word of encoded.split('\r\n ')) {
      expect(word.length).toBeLessThanOrEqual(75)
      expect(word).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/)
      // every word decodes to whole characters on its own
      expect(decodeMimeWords(word)).not.toContain('�')
    }
  })

  it('does not let a line pass the recommended length', () => {
    const subject = `Subject: ${encodeText('Ünïcödé '.repeat(30), 9)}`
    for (const line of subject.split('\r\n')) expect(line.length).toBeLessThanOrEqual(76)
    const long = `Subject: ${encodeText('plain words '.repeat(30), 9)}`
    for (const line of long.split('\r\n')) expect(line.length).toBeLessThanOrEqual(76)
  })

  it('encodes text that looks like an encoded word, so that it is not read as one', () => {
    expect(roundTrip('=?UTF-8?B?QQ==?= is not A')).toBe('=?UTF-8?B?QQ==?= is not A')
  })

  it('writes a parameter in both forms when it is not ASCII', () => {
    expect(parameter('filename', 'report.pdf')).toBe('filename="report.pdf"')
    expect(parameter('filename', 'Bericht März.pdf')).toBe(`filename="Bericht M_rz.pdf";\r\n\tfilename*=UTF-8''Bericht%20M%C3%A4rz.pdf`)
    expect(parameter('filename', 'a"b\\c.txt')).toBe('filename="a\\"b\\\\c.txt"')
  })
})

describe('quoted-printable', () => {
  it('keeps plain text, encodes the rest and ends no line with a space', () => {
    expect(quotedPrintable('a = b \r\nüber\ttab\t')).toBe('a =3D b=20\r\n=C3=BCber\ttab=09')
  })

  it('cuts no line longer than 76 characters', () => {
    const out = quotedPrintable('word '.repeat(100) + 'ü'.repeat(60))
    for (const line of out.split('\r\n')) expect(line.length).toBeLessThanOrEqual(76)
  })

  it('is read back as it was written, for any text', () => {
    const samples = [
      '', 'plain', 'a\r\nb\r\n', 'trailing space \r\nnext', '= = ==', '   ', '\tx\t',
      'Grüße 😀 日本', 'x'.repeat(200), 'ü'.repeat(200), 'a=\r\nb', `${'word '.repeat(40)}end`
    ]
    // and a few hundred of no pattern at all
    let seed = 7
    const next = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    const pieces = ['a', 'b', ' ', '\t', '=', '\r\n', 'ü', '€', '😀', '.', 'x'.repeat(30)]
    for (let i = 0; i < 300; i++) {
      samples.push(Array.from({ length: Math.floor(next() * 40) }, () => pieces[Math.floor(next() * pieces.length)]).join(''))
    }
    for (const sample of samples) {
      const normalised = sample.replace(/\r\n|\r|\n/g, '\r\n')
      expect(decodeQuotedPrintable(quotedPrintable(sample)), JSON.stringify(sample)).toBe(normalised)
    }
  })
})

describe('the body', () => {
  it('sends plain short text as 7-bit, line ends as CR LF', () => {
    const { body, headers } = split(compose({ text: 'one\ntwo\n' }).source)
    expect(body).toBe('one\r\ntwo\r\n')
    expect(headers.get('content-transfer-encoding')).toBe('7bit')
  })

  it('sends text with more than ASCII as quoted-printable, which is 7-bit', () => {
    const composed = compose({ text: 'Grüße 😀\r\n' })
    const { body, headers } = split(composed.source)
    expect(headers.get('content-transfer-encoding')).toBe('quoted-printable')
    expect(body).toBe('Gr=C3=BC=C3=9Fe =F0=9F=98=80\r\n')
    expect([...composed.source].every((byte) => byte < 128)).toBe(true)
  })

  it('sends text with a very long line as quoted-printable, so that no line is too long', () => {
    const { body } = split(compose({ text: 'x'.repeat(500) }).source)
    for (const line of body.split('\r\n')) expect(line.length).toBeLessThanOrEqual(76)
    expect(decodeQuotedPrintable(body)).toBe('x'.repeat(500))
  })

  it('sends text and HTML as alternatives, the plain one first', () => {
    const { headers, body } = split(compose({ text: 'plain', html: '<p>rich</p>' }).source)
    const boundary = /boundary="([^"]+)"/.exec(headers.get('content-type') as string)?.[1] as string
    expect(headers.get('content-type')).toMatch(/^multipart\/alternative;/)
    const parts = body.split(`--${boundary}`).slice(1)
    expect(parts).toHaveLength(3)
    expect(parts[0]).toContain('Content-Type: text/plain; charset=utf-8')
    expect(parts[0]).toContain('plain')
    expect(parts[1]).toContain('Content-Type: text/html; charset=utf-8')
    expect(parts[1]).toContain('<p>rich</p>')
    expect(parts[2]).toBe(`--\r\n`)
  })

  it('sends only HTML as one HTML part, and only text as one text part', () => {
    expect(split(compose({ text: undefined, html: '<b>x</b>' }).source).headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(split(compose({ text: undefined }).source).headers.get('content-type')).toBe('text/plain; charset=utf-8')
  })

  it('picks a boundary that is not in the text', () => {
    // a random() that gives the same boundary twice; the first is in the text
    const values = [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]
    let at = 0
    const random = (): number => (at < values.length ? values[at++] : 0.9)
    const clash = `--=_peregrine_${'d'.repeat(24)}`
    const composed = composeMessage({ ...base, text: `before\r\n${clash}\r\nafter`, html: '<p>x</p>' }, { ...fixed, random })
    const boundary = /boundary="([^"]+)"/.exec(text(composed.source))?.[1] as string
    expect(`--${boundary}`).not.toBe(clash)
    expect(text(composed.source).split(`--${boundary}`)).toHaveLength(4)
  })
})

describe('attachments', () => {
  const content = Uint8Array.from({ length: 1000 }, (_, i) => (i * 7) % 256)

  it('sends them as base64 in lines of at most 76, inside a multipart/mixed', () => {
    const composed = compose({ attachments: [{ filename: 'data.bin', contentType: 'application/octet-stream', content }] })
    const { headers, body } = split(composed.source)
    const boundary = /boundary="([^"]+)"/.exec(headers.get('content-type') as string)?.[1] as string
    expect(headers.get('content-type')).toMatch(/^multipart\/mixed;/)
    const parts = body.split(`--${boundary}`)
    expect(parts).toHaveLength(4)
    const attachment = parts[2]
    expect(attachment).toContain('Content-Transfer-Encoding: base64')
    expect(attachment).toContain('Content-Disposition: attachment;\r\n\tfilename="data.bin"')
    const encoded = attachment.split('\r\n\r\n')[1].trimEnd()
    for (const line of encoded.split('\r\n')) expect(line.length).toBeLessThanOrEqual(76)
    expect([...decodeBase64(encoded.replace(/\r\n/g, ''))]).toEqual([...content])
    expect(parts[3]).toBe('--\r\n')
  })

  it('puts the text first, whether it is one part or alternatives', () => {
    const composed = compose({ text: 'see attached', html: '<p>see attached</p>', attachments: [{ filename: 'a.txt', content: Uint8Array.of(65) }] })
    const all = text(composed.source)
    expect(all.indexOf('multipart/alternative')).toBeGreaterThan(all.indexOf('multipart/mixed'))
    expect(all.indexOf('multipart/alternative')).toBeLessThan(all.indexOf('Content-Disposition'))
  })

  it('names a file that is not ASCII in both forms', () => {
    const shown = text(compose({ attachments: [{ filename: 'Bericht März.pdf', content: Uint8Array.of(1) }] }).source)
    expect(shown).toContain(`filename*=UTF-8''Bericht%20M%C3%A4rz.pdf`)
    expect(shown).toContain('filename="Bericht M_rz.pdf"')
  })

  it('treats a type that is not one as no type', () => {
    for (const bad of ['', 'nonsense', 'text/', '/plain', 'text/plain; x=y', 'a b/c']) {
      const shown = text(compose({ attachments: [{ filename: 'f', contentType: bad, content: Uint8Array.of(1) }] }).source)
      expect(shown, bad).toContain('Content-Type: application/octet-stream;')
    }
  })

  it('sends an empty file and several files', () => {
    const composed = compose({ attachments: [{ filename: 'empty', content: new Uint8Array(0) }, { filename: 'b', content: Uint8Array.of(1, 2) }, { filename: 'c', content: Uint8Array.of(3) }] })
    const boundary = /boundary="([^"]+)"/.exec(text(composed.source))?.[1] as string
    expect(text(composed.source).split(`--${boundary}`)).toHaveLength(6)
  })

  it('is 7-bit all through, so that any server takes it', () => {
    const composed = compose({ subject: 'Grüße', text: 'Grüße 😀', html: '<p>ü</p>', attachments: [{ filename: 'ü.txt', content }] })
    expect([...composed.source].every((byte) => byte < 128)).toBe(true)
    expect(text(composed.source)).not.toMatch(/(^|[^\r])\n/)
  })
})
