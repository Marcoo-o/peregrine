import { describe, expect, it } from 'vitest'
import { attachmentContent, listAttachments } from './attachments'
import { contentTypeFor, extensionFor } from './mimeTypes'

const bytes = (text: string): Uint8Array => Uint8Array.from(text, (c) => c.charCodeAt(0))
const text = (data: Uint8Array | undefined): string => (data ? new TextDecoder().decode(data) : '<none>')
const crlf = (lines: string[]): Uint8Array => bytes(lines.join('\r\n'))

/** "hello" in base64, as an attachment part. */
const helloPart = (headers: string[]): string[] => [
  '--b',
  ...headers,
  'Content-Transfer-Encoding: base64',
  '',
  'aGVsbG8=',
  ''
]

const mixed = (...parts: string[][]): Uint8Array =>
  crlf([
    'From: Anna <anna@example.net>',
    'Subject: Files',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="b"',
    '',
    '--b',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'See the attachment.',
    ...parts.flat(),
    '--b--',
    ''
  ])

describe('the attachments of a message', () => {
  it('has none for a message that is only text', () => {
    expect(listAttachments(crlf(['Subject: Hi', 'Content-Type: text/plain', '', 'Hello', '']))).toEqual([])
    expect(listAttachments(mixed())).toEqual([])
  })

  it('lists one with its name, type and the size it has once decoded', () => {
    const list = listAttachments(
      mixed(helloPart(['Content-Type: application/pdf; name="report.pdf"', 'Content-Disposition: attachment; filename="report.pdf"']))
    )
    expect(list).toEqual([
      { id: '2', filename: 'report.pdf', originalName: 'report.pdf', contentType: 'application/pdf', size: 5, findings: [] }
    ])
  })

  it('takes the name from the content type when the disposition has none', () => {
    const [attachment] = listAttachments(mixed(helloPart(['Content-Type: application/pdf; name="old-style.pdf"'])))
    expect(attachment.filename).toBe('old-style.pdf')
  })

  it('reads a name with an umlaut in the form that is used now, and in an encoded word', () => {
    const list = listAttachments(
      mixed(
        helloPart(["Content-Disposition: attachment; filename*=UTF-8''Gr%C3%BC%C3%9Fe.pdf", 'Content-Type: application/pdf']),
        helloPart(['Content-Disposition: attachment; filename="=?UTF-8?B?UsOkY2hudW5nLnBkZg==?="', 'Content-Type: application/pdf'])
      )
    )
    expect(list.map((a) => a.filename)).toEqual(['Grüße.pdf', 'Rächnung.pdf'])
  })

  it('finds attachments inside nested parts, and numbers them by where they are', () => {
    const source = crlf([
      'Content-Type: multipart/mixed; boundary="outer"',
      '',
      '--outer',
      'Content-Type: multipart/alternative; boundary="inner"',
      '',
      '--inner',
      'Content-Type: text/plain',
      '',
      'plain',
      '--inner',
      'Content-Type: text/html',
      '',
      '<p>html</p>',
      '--inner--',
      '--outer',
      'Content-Type: text/plain; name="notes.txt"',
      'Content-Disposition: attachment; filename="notes.txt"',
      '',
      'the notes',
      '--outer--',
      ''
    ])
    const list = listAttachments(source)
    expect(list.map((a) => [a.id, a.filename])).toEqual([['2', 'notes.txt']])
    expect(text(attachmentContent(source, '2'))).toBe('the notes')
  })

  it('does not list the text of the message, but lists a text file that has a name', () => {
    const list = listAttachments(mixed(['--b', 'Content-Type: text/plain; name="a.txt"', '', 'x', '']))
    expect(list.map((a) => a.filename)).toEqual(['a.txt'])
  })

  it('lists an image that is shown inside the message, which has no name, with one made for it', () => {
    const [image] = listAttachments(mixed(helloPart(['Content-Type: image/png', 'Content-ID: <logo>', 'Content-Disposition: inline'])))
    expect(image).toMatchObject({ filename: 'anhang-1.png', originalName: null, contentType: 'image/png' })
  })

  it('lists a message that was attached', () => {
    const [forwarded] = listAttachments(mixed(['--b', 'Content-Type: message/rfc822', '', 'Subject: old', '', 'body', '']))
    expect(forwarded.contentType).toBe('message/rfc822')
  })

  it('lists a message that is one file and nothing else', () => {
    const source = crlf(['Content-Type: image/png; name="p.png"', 'Content-Transfer-Encoding: base64', '', 'aGVsbG8=', ''])
    expect(listAttachments(source).map((a) => [a.id, a.filename, a.size])).toEqual([['1', 'p.png', 5]])
    expect(text(attachmentContent(source, '1'))).toBe('hello')
  })

  it('lists two with the same name as two', () => {
    const part = helloPart(['Content-Type: application/pdf; name="same.pdf"'])
    const list = listAttachments(mixed(part, part))
    expect(list.map((a) => [a.id, a.filename])).toEqual([
      ['2', 'same.pdf'],
      ['3', 'same.pdf']
    ])
  })

  describe('the names', () => {
    const nameOf = (header: string): string =>
      listAttachments(mixed(helloPart([`Content-Disposition: attachment; filename="${header}"`])))[0].filename

    // A name that arrives is written to a file system, and a path in it is where it would end up.
    it('are made safe: no path, no control characters, no leading dots', () => {
      expect(nameOf('../../etc/passwd')).toBe('_.._etc_passwd')
      // a backslash that is written as one in a quoted value, and one that is only an escape
      expect(nameOf('..\\\\..\\\\evil.dll')).toBe('_.._evil.dll')
      expect(nameOf('..\\..\\evil.dll')).toBe('evil.dll')
      expect(nameOf('.hidden')).toBe('hidden')
    })

    it('keep the extension when they are too long', () => {
      const name = nameOf(`${'a'.repeat(200)}.pdf`)
      expect(name.length).toBeLessThanOrEqual(120)
      expect(name.endsWith('.pdf')).toBe(true)
    })

    it('get one made for them when nothing is left of them', () => {
      expect(nameOf('...')).toBe('anhang-1')
    })

    it('are judged by the name they are saved under, so a program is a program', () => {
      const [exe] = listAttachments(mixed(helloPart(['Content-Disposition: attachment; filename="invoice.pdf.exe"'])))
      expect(exe.findings.map((f) => f.risk)).toEqual(['executable', 'doubleExtension'])
      const [zip] = listAttachments(mixed(helloPart(['Content-Disposition: attachment; filename="files.zip"'])))
      expect(zip.findings.map((f) => f.risk)).toEqual(['archive'])
    })
  })
})

describe('the content of an attachment', () => {
  it('is decoded from base64 and from quoted-printable', () => {
    const source = mixed(
      helloPart(['Content-Type: application/octet-stream; name="a.bin"']),
      ['--b', 'Content-Type: text/plain; name="b.txt"', 'Content-Transfer-Encoding: quoted-printable', '', 'caf=C3=A9']
    )
    expect(text(attachmentContent(source, '2'))).toBe('hello')
    expect(text(attachmentContent(source, '3'))).toBe('café')
  })

  it('is exact for bytes that are not text', () => {
    const source = crlf([
      'Content-Type: application/octet-stream; name="x.bin"',
      'Content-Transfer-Encoding: base64',
      '',
      '/+8AAQID',
      ''
    ])
    expect([...(attachmentContent(source, '1') as Uint8Array)]).toEqual([0xff, 0xef, 0x00, 0x01, 0x02, 0x03])
  })

  it('is not there for a part that is not an attachment, or does not exist', () => {
    const source = mixed(helloPart(['Content-Type: application/pdf; name="a.pdf"']))
    expect(attachmentContent(source, '1')).toBeUndefined()
    expect(attachmentContent(source, '9')).toBeUndefined()
    expect(attachmentContent(source, '2.1')).toBeUndefined()
    expect(attachmentContent(source, 'x')).toBeUndefined()
    expect(attachmentContent(source, '0')).toBeUndefined()
  })
})

describe('media types', () => {
  it('lead from an extension to a type, in any case, and to octet-stream when nothing is known', () => {
    expect(contentTypeFor('Report.PDF')).toBe('application/pdf')
    expect(contentTypeFor('photo.jpeg')).toBe('image/jpeg')
    expect(contentTypeFor('thing.xyz')).toBe('application/octet-stream')
    expect(contentTypeFor('noextension')).toBe('application/octet-stream')
    expect(contentTypeFor('.hidden')).toBe('application/octet-stream')
  })

  it('lead back from a type to the first extension listed for it', () => {
    expect(extensionFor('image/jpeg')).toBe('.jpg')
    expect(extensionFor('IMAGE/PNG')).toBe('.png')
    expect(extensionFor('application/x-unknown')).toBe('')
  })
})
