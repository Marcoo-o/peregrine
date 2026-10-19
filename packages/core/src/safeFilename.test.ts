import { describe, expect, it } from 'vitest'
import { isInside, safeFilename } from './safeFilename'

/** Built from a code point so no control character ends up in this file as itself. */
const control = (code: number): string => String.fromCharCode(code)

/**
 * The spellings below are the ones mailparser was measured to hand over unchanged. The RFC 2231
 * and RFC 2047 forms decode before we see them, so they arrive as plain `../../x` and need no
 * separate case here beyond the one that proves the decoded shape is caught.
 */
describe('safeFilename', () => {
  it('leaves an ordinary name alone', () => {
    expect(safeFilename('Rechnung 2026-08.pdf', 'x')).toBe('Rechnung 2026-08.pdf')
  })

  /**
   * Spells out which characters the replacement set holds, because a mistake in that set is
   * invisible. An earlier version of this file lost the backslash to a shell that ate it, and
   * nothing would have noticed.
   */
  it('replaces exactly the characters that carry structure', () => {
    for (const bad of ['/', '\\', ':', '*', '?', '"', '<', '>', '|']) {
      expect(safeFilename(`a${bad}b`, 'x')).toBe('a_b')
    }
    for (const good of [' ', '-', '_', '(', ')', '+', '&', 'ä']) {
      expect(safeFilename(`a${good}b`, 'x')).toBe(`a${good}b`)
    }
  })

  // A newline in the name would let it span two lines wherever it is shown or logged.
  it('replaces control characters', () => {
    expect(safeFilename(`a${control(0)}b`, 'x')).toBe('a_b')
    expect(safeFilename(`a${control(10)}b`, 'x')).toBe('a_b')
    expect(safeFilename(`a${control(31)}b`, 'x')).toBe('a_b')
    expect(safeFilename(`a${control(127)}b`, 'x')).toBe('a_b')
  })

  it('strips the separators a traversal is built from', () => {
    for (const attack of [
      '../../escaped.txt',
      '..\\..\\escaped.txt',
      '../../../../Users/someone/Startup/evil.cmd',
      '/etc/passwd',
      'C:\\Windows\\Temp\\evil.exe',
      '\\\\server\\share\\evil.exe'
    ]) {
      const result = safeFilename(attack, 'fallback')
      expect(result).not.toMatch(/[/\\]/)
      expect(result).not.toBe('..')
    }
  })

  /**
   * The case that defeats a filter which merely removes `..`. Removing the inner pair from
   * `....//` leaves `../`, so this has to be caught by replacing rather than deleting.
   */
  it('cannot be defeated by nesting the pattern', () => {
    expect(safeFilename('....//....//evil.txt', 'x')).not.toMatch(/[/\\]/)
    expect(safeFilename('..../\\..../\\evil.txt', 'x')).not.toMatch(/[/\\]/)
  })

  it('refuses to produce a name that is only dots', () => {
    expect(safeFilename('..', 'fallback')).toBe('fallback')
    expect(safeFilename('.', 'fallback')).toBe('fallback')
    expect(safeFilename('', 'fallback')).toBe('fallback')
    expect(safeFilename(null, 'fallback')).toBe('fallback')
  })

  // An alternate data stream attaches content to a file that most tools never display.
  it('closes the alternate data stream', () => {
    expect(safeFilename('invoice.pdf:hidden.exe', 'x')).toBe('invoice.pdf_hidden.exe')
  })

  /**
   * Windows drops trailing dots and spaces when it opens a file. Without this, a name checked
   * as `evil.exe.` would be created as `evil.exe`, so the check would have run on a name that
   * never reaches the file system.
   */
  it('removes trailing dots and spaces before anything else looks at the name', () => {
    expect(safeFilename('evil.exe.', 'x')).toBe('evil.exe')
    expect(safeFilename('evil.exe ', 'x')).toBe('evil.exe')
  })

  it('gets a reserved device name out of the way', () => {
    expect(safeFilename('CON', 'x')).toBe('_CON')
    expect(safeFilename('nul.txt', 'x')).toBe('_nul.txt')
    // Not reserved, only starts the same way.
    expect(safeFilename('console.log', 'x')).toBe('console.log')
  })

  it('shortens from the front so the extension survives', () => {
    const long = 'a'.repeat(400) + '.pdf'
    const result = safeFilename(long, 'x')
    expect(result.length).toBeLessThanOrEqual(120)
    expect(result.endsWith('.pdf')).toBe(true)
  })

  it('keeps a name that is nothing but an extension usable', () => {
    expect(safeFilename('.gitignore', 'x')).toBe('gitignore')
  })
})

describe('isInside', () => {
  const dir = 'C:\\cache\\account\\message'

  it('accepts a path in the directory', () => {
    expect(isInside(dir, dir + '\\file.pdf', '\\')).toBe(true)
  })

  it('rejects a path that escaped', () => {
    expect(isInside(dir, 'C:\\cache\\account\\file.pdf', '\\')).toBe(false)
    expect(isInside(dir, 'C:\\Windows\\Temp\\file.pdf', '\\')).toBe(false)
  })

  // A sibling whose name merely starts the same way is not inside.
  it('rejects a sibling with a longer name', () => {
    expect(isInside(dir, 'C:\\cache\\account\\message-other\\file.pdf', '\\')).toBe(false)
  })

  it('rejects the directory itself', () => {
    expect(isInside(dir, dir, '\\')).toBe(false)
  })
})
