import { describe, expect, it } from 'vitest'
import { highlightMailSource } from './mailSyntax'

const MESSAGE = [
  'From: John Doe <john@peregrine.example>',
  'Subject: Rechnung 4711',
  'Content-Type: multipart/mixed;',
  ' boundary="grenze"',
  '',
  '--grenze',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Guten Tag,',
  'From: das hier ist zitierter Text, kein Kopfzeilenfeld',
  '--grenze--'
].join('\r\n')

describe('highlightMailSource', () => {
  it('separates a header into its name and its value', () => {
    const [first] = highlightMailSource(MESSAGE)
    expect(first).toEqual({
      kind: 'headerName',
      name: 'From',
      text: 'John Doe <john@peregrine.example>'
    })
  })

  it('marks a folded line as a continuation of the header above it', () => {
    const lines = highlightMailSource(MESSAGE)
    expect(lines[3]).toEqual({ kind: 'continuation', text: ' boundary="grenze"' })
  })

  it('marks the MIME boundaries', () => {
    const kinds = highlightMailSource(MESSAGE).filter((line) => line.kind === 'boundary')
    expect(kinds).toHaveLength(2)
  })

  // The point of tracking the blank line: this is what tells a header from quoted text.
  it('reads a header-shaped line in the body as body', () => {
    const line = highlightMailSource(MESSAGE).find((l) => l.text.startsWith('From: das hier'))
    expect(line?.kind).toBe('body')
  })

  it('starts reading headers again after a boundary', () => {
    const lines = highlightMailSource(MESSAGE)
    const afterBoundary = lines[lines.findIndex((l) => l.kind === 'boundary') + 1]
    expect(afterBoundary.kind).toBe('headerName')
    expect(afterBoundary.name).toBe('Content-Type')
  })

  it('dims a base64 block', () => {
    const source = ['Content-Type: image/png', '', 'iVBORw0KGgoAAAANSUhEUg' + 'A'.repeat(60)].join('\n')
    expect(highlightMailSource(source).at(-1)?.kind).toBe('encoded')
  })

  it('dims a quoted-printable line', () => {
    const source = ['Subject: Test', '', 'Gr=C3=BC=C3=9Fe aus Berlin'].join('\n')
    expect(highlightMailSource(source).at(-1)?.kind).toBe('encoded')
  })

  it('gives up on headers when the block ends without a blank line', () => {
    const source = ['Subject: Test', 'einfach nur Text ohne Doppelpunkt'].join('\n')
    expect(highlightMailSource(source)[1].kind).toBe('body')
  })

  it('handles both line ending conventions the same way', () => {
    expect(highlightMailSource('A: 1\r\nB: 2')).toEqual(highlightMailSource('A: 1\nB: 2'))
  })

  it('drops the empty line a trailing newline leaves behind', () => {
    expect(highlightMailSource('Subject: Test\n')).toHaveLength(1)
  })

  it('returns nothing for an empty source', () => {
    expect(highlightMailSource('')).toEqual([])
  })
})
