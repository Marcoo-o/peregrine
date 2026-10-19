import { describe, expect, it } from 'vitest'
import {
  attachmentsFromPaths,
  mentionsAttachment,
  shouldWarnAboutAttachment
} from './attachmentHints'

describe('mentionsAttachment', () => {
  it('catches the common German announcements', () => {
    expect(mentionsAttachment('Hallo, anbei die Rechnung.')).toBe(true)
    expect(mentionsAttachment('Die Unterlagen sind beigefügt.')).toBe(true)
    expect(mentionsAttachment('Details im Anhang.')).toBe(true)
    expect(mentionsAttachment('Ich hänge den Vertrag an.')).toBe(true)
  })

  it('catches the common English ones', () => {
    expect(mentionsAttachment('Please see attached.')).toBe(true)
    expect(mentionsAttachment('I am attaching the report.')).toBe(true)
    expect(mentionsAttachment('Please find enclosed the invoice.')).toBe(true)
  })

  // A warning that fires on ordinary sentences gets dismissed unread, which is worse than none.
  it('stays quiet on a bare mention of the word', () => {
    expect(mentionsAttachment('Danke für den Anhang von gestern.')).toBe(false)
    expect(mentionsAttachment('Der Anhang war leider unlesbar.')).toBe(false)
    expect(mentionsAttachment('Wir sprechen morgen über den Vertrag.')).toBe(false)
  })

  // Replying to "anbei die Rechnung" must not warn about the other person's attachment.
  it('ignores quoted lines', () => {
    expect(mentionsAttachment('Danke!\n\n> Hallo, anbei die Rechnung.')).toBe(false)
  })

  it('ignores a quoted block in HTML', () => {
    expect(
      mentionsAttachment('<p>Danke!</p><blockquote><p>anbei die Rechnung</p></blockquote>')
    ).toBe(false)
  })

  it('reads through HTML tags', () => {
    expect(mentionsAttachment('<p>Hallo,</p><p>an<b>bei</b> die Rechnung.</p>')).toBe(false)
    expect(mentionsAttachment('<p>Hallo, <b>anbei</b> die Rechnung.</p>')).toBe(true)
  })
})

describe('shouldWarnAboutAttachment', () => {
  it('warns when something was announced and nothing is attached', () => {
    expect(shouldWarnAboutAttachment('anbei die Rechnung', 0)).toBe(true)
  })

  it('stays quiet once a file is attached', () => {
    expect(shouldWarnAboutAttachment('anbei die Rechnung', 1)).toBe(false)
  })

  it('stays quiet on a message that promises nothing', () => {
    expect(shouldWarnAboutAttachment('Bis morgen!', 0)).toBe(false)
  })
})

describe('attachmentsFromPaths', () => {
  it('takes the file name from the path', () => {
    expect(attachmentsFromPaths(['C:\\Users\\m\\Rechnung.pdf'], [])).toEqual([
      { filename: 'Rechnung.pdf', path: 'C:\\Users\\m\\Rechnung.pdf' }
    ])
  })

  it('handles POSIX paths too', () => {
    expect(attachmentsFromPaths(['/home/m/bericht.txt'], [])[0].filename).toBe('bericht.txt')
  })

  // Dropping the same file twice is a slip, not a request for two copies.
  it('skips what is already attached', () => {
    expect(attachmentsFromPaths(['/a/x.pdf'], ['/a/x.pdf'])).toEqual([])
  })

  it('skips repeats within one drop', () => {
    expect(attachmentsFromPaths(['/a/x.pdf', '/a/x.pdf'], [])).toHaveLength(1)
  })

  // Electron reports a directory with an empty path; sending it would attach nothing.
  it('skips entries without a path', () => {
    expect(attachmentsFromPaths(['', '/a/x.pdf'], [])).toHaveLength(1)
  })
})
