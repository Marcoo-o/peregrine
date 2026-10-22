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
    expect(message).toMatchObject({
      subject: 'Hallo',
      from: 'Alex <alex@example.org>',
      date: 'Mon, 19 Oct 2026 10:00:00 +0200',
      text: 'Guten Tag\r\n',
      messageId: '',
      references: '',
      replyTo: '',
      html: null,
      to: '',
      cc: '',
      inlineImages: {}
    })
  })

  it('reads the headers an answer needs to join the thread', () => {
    const message = readMessage(
      bytes(
        crlf([
          'From: Anna <anna@example.net>',
          'Reply-To: Lists <list@example.net>',
          'Message-ID: <two@example.net>',
          'References: <zero@example.net>',
          ' <one@example.net>',
          '',
          'x'
        ])
      )
    )
    expect(message).toMatchObject({
      messageId: '<two@example.net>',
      references: '<zero@example.net> <one@example.net>',
      replyTo: 'Lists <list@example.net>'
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

describe('the blind copy of a message that was kept to be written on', () => {
  it('is read from its Bcc header, with the names decoded, and is empty where there is none', () => {
    const kept = readMessage(
      bytes(crlf(['From: work@example.org', 'To: anna@example.net', 'Bcc: =?utf-8?Q?J=C3=BCrgen?= <juergen@example.net>', 'Subject: Hi', '', 'Text', '']))
    )
    expect(kept.bcc).toBe('Jürgen <juergen@example.net>')
    expect(readMessage(bytes(crlf(['From: a@example.net', 'Subject: Hi', '', 'Text', '']))).bcc).toBe('')
  })
})

describe('readMessage, for showing it as the sender wrote it', () => {
  const html = '<p>Hello <b>world</b></p>'

  it('keeps the HTML of a message as it is, and the text with the tags off for what needs text', () => {
    const message = readMessage(bytes(crlf(['Content-Type: text/html; charset=utf-8', '', html, ''])))
    expect(message.html).toBe(html + '\r\n')
    expect(message.text).toContain('Hello world')
  })

  it('has both the plain text and the HTML of an alternative, and the text is the plain one', () => {
    const message = readMessage(
      bytes(
        crlf([
          'Content-Type: multipart/alternative; boundary=b',
          '',
          '--b',
          'Content-Type: text/plain',
          '',
          'plain version',
          '--b',
          'Content-Type: text/html',
          '',
          html,
          '--b--',
          ''
        ])
      )
    )
    expect(message.text).toBe('plain version')
    expect(message.html).toBe(html)
  })

  it('decodes the HTML in the charset and the transfer encoding it has', () => {
    const message = readMessage(
      bytes(
        crlf([
          'Content-Type: text/html; charset=iso-8859-1',
          'Content-Transfer-Encoding: quoted-printable',
          '',
          '<p>Gr=FC=DFe</p>',
          ''
        ])
      )
    )
    expect(message.html).toBe('<p>Grüße</p>\r\n')
  })

  it('is not fooled by an HTML attachment into taking it for the message', () => {
    const message = readMessage(
      bytes(
        crlf([
          'Content-Type: multipart/mixed; boundary=b',
          '',
          '--b',
          'Content-Type: text/plain',
          '',
          'the message',
          '--b',
          'Content-Type: text/html',
          'Content-Disposition: attachment; filename=page.html',
          '',
          '<p>not the message</p>',
          '--b--',
          ''
        ])
      )
    )
    expect(message.html).toBeNull()
    expect(message.text).toBe('the message')
  })

  it('reads who it is to and who has a copy', () => {
    const message = readMessage(
      bytes(crlf(['To: Alex <alex@example.org>, b@example.net', 'Cc: =?UTF-8?B?R3LDvMOfZQ==?= <c@example.net>', '', 'x']))
    )
    expect(message.to).toBe('Alex <alex@example.org>, b@example.net')
    expect(message.cc).toBe('Grüße <c@example.net>')
  })

  it('has the headers that say what the server made of it, by lower case name', () => {
    const message = readMessage(
      bytes(
        crlf([
          'Authentication-Results: mx.example.org; spf=fail smtp.mailfrom=example.net',
          'X-Spamd-Result: default: False [3.20 / 15.00]; ARC_NA(0.00)[]',
          'Subject: x',
          '',
          'x'
        ])
      )
    )
    expect(message.headers['authentication-results']).toContain('spf=fail')
    expect(message.headers['x-spamd-result']).toContain('3.20')
  })

  it('takes the images that the HTML refers to by content id, as data the HTML can show', () => {
    const message = readMessage(
      bytes(
        crlf([
          'Content-Type: multipart/related; boundary=b',
          '',
          '--b',
          'Content-Type: text/html',
          '',
          '<img src="cid:logo@example.net">',
          '--b',
          'Content-Type: image/png',
          'Content-ID: <logo@example.net>',
          'Content-Transfer-Encoding: base64',
          '',
          'iVBORw0KGgo=',
          '--b--',
          ''
        ])
      )
    )
    expect(message.inlineImages).toEqual({ 'logo@example.net': 'data:image/png;base64,iVBORw0KGgo=' })
  })

  it('takes only images, and none that is too big to hold on to', () => {
    const big = 'A'.repeat(8 * 1024 * 1024)
    const message = readMessage(
      bytes(
        crlf([
          'Content-Type: multipart/related; boundary=b',
          '',
          '--b',
          'Content-Type: text/html',
          '',
          '<p>x</p>',
          '--b',
          'Content-Type: application/pdf',
          'Content-ID: <doc@example.net>',
          'Content-Transfer-Encoding: base64',
          '',
          'JVBERi0=',
          '--b',
          'Content-Type: image/jpeg',
          'Content-ID: <huge@example.net>',
          'Content-Transfer-Encoding: base64',
          '',
          big,
          '--b--',
          ''
        ])
      )
    )
    expect(message.inlineImages).toEqual({})
    // A message of 8 MB is read here, which a slow runner that has other tests to run takes longer for than the 5 s a test gets.
  }, 30_000)
})
