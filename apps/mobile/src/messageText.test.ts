import { describe, expect, it } from 'vitest'
import { readMessage } from './messageText'

const bytes = (text: string): Uint8Array => Uint8Array.from(Buffer.from(text, 'latin1'))
const utf8 = (text: string): Uint8Array => Uint8Array.from(Buffer.from(text, 'utf8'))
const crlf = (lines: string[]): string => lines.join('\r\n')

describe('readMessage', () => {
  it('reads the headers and the text of a plain message', () => {
    const message = readMessage(
      bytes(crlf(['From: Alex <alex@example.org>', 'Subject: Hallo', 'Date: Mon, 19 Oct 2026 10:00:00 +0200', '', 'Guten Tag', '']))
    )
    expect(message).toEqual({
      subject: 'Hallo',
      from: 'Alex <alex@example.org>',
      date: 'Mon, 19 Oct 2026 10:00:00 +0200',
      text: 'Guten Tag\r\n'
    })
  })

  it('decodes an encoded subject', () => {
    const message = readMessage(bytes(crlf(['Subject: =?UTF-8?B?R3LDvMOfZQ==?=', '', 'x'])))
    expect(message.subject).toBe('Grüße')
  })

  it('joins a header that continues on the next line', () => {
    const message = readMessage(bytes(crlf(['Subject: eine lange', ' Zeile', '', 'x'])))
    expect(message.subject).toBe('eine lange Zeile')
  })

  it('reads a message that uses bare line feeds', () => {
    const message = readMessage(bytes('Subject: Hi\n\nText\n'))
    expect(message.subject).toBe('Hi')
    expect(message.text).toBe('Text\n')
  })

  it('decodes quoted-printable text in the charset it declares', () => {
    const message = readMessage(
      bytes(
        crlf([
          'Content-Type: text/plain; charset=iso-8859-1',
          'Content-Transfer-Encoding: quoted-printable',
          '',
          'Gr=FC=DFe, eine lange =',
          'Zeile',
          ''
        ])
      )
    )
    expect(message.text).toBe('Grüße, eine lange Zeile\r\n')
  })

  it('decodes base64 text', () => {
    const message = readMessage(
      bytes(
        crlf([
          'Content-Type: text/plain; charset=utf-8',
          'Content-Transfer-Encoding: base64',
          '',
          'R3LDvMOfZQ==',
          ''
        ])
      )
    )
    expect(message.text).toBe('Grüße')
  })

  it('takes the plain part of a multipart/alternative, not the HTML', () => {
    const message = readMessage(
      utf8(
        crlf([
          'Content-Type: multipart/alternative; boundary="b1"',
          '',
          '--b1',
          'Content-Type: text/plain; charset=utf-8',
          '',
          'Nur Text',
          '--b1',
          'Content-Type: text/html; charset=utf-8',
          '',
          '<p>Nur <b>HTML</b></p>',
          '--b1--',
          ''
        ])
      )
    )
    expect(message.text).toBe('Nur Text')
  })

  it('falls back to the HTML with its tags taken off', () => {
    const message = readMessage(
      utf8(
        crlf([
          'Content-Type: multipart/alternative; boundary=b1',
          '',
          '--b1',
          'Content-Type: text/html; charset=utf-8',
          '',
          '<style>p{color:red}</style><p>Eins &amp; zwei</p><p>Drei</p>',
          '--b1--',
          ''
        ])
      )
    )
    expect(message.text).toBe('Eins & zwei\nDrei')
  })

  it('finds the text inside a multipart/mixed with an attachment', () => {
    const message = readMessage(
      utf8(
        crlf([
          'Content-Type: multipart/mixed; boundary="outer"',
          '',
          '--outer',
          'Content-Type: multipart/alternative; boundary="inner"',
          '',
          '--inner',
          'Content-Type: text/plain; charset=utf-8',
          '',
          'Der Text',
          '--inner--',
          '--outer',
          'Content-Type: text/plain; name="notes.txt"',
          'Content-Disposition: attachment; filename="notes.txt"',
          '',
          'Das ist der Anhang',
          '--outer--',
          ''
        ])
      )
    )
    expect(message.text).toBe('Der Text')
  })

  it('does not show a text attachment as the message', () => {
    const message = readMessage(
      utf8(
        crlf([
          'Content-Type: multipart/mixed; boundary="b"',
          '',
          '--b',
          'Content-Type: text/plain',
          'Content-Disposition: attachment; filename="a.txt"',
          '',
          'nur Anhang',
          '--b--',
          ''
        ])
      )
    )
    expect(message.text).toBe('')
  })

  it('gives empty text for a message that has none, and does not throw', () => {
    expect(readMessage(bytes('')).text).toBe('')
    expect(readMessage(bytes('Subject: nur Kopf')).subject).toBe('nur Kopf')
    expect(readMessage(bytes('Content-Type: multipart/mixed\r\n\r\nkein Boundary')).text).toBe('')
  })
})
