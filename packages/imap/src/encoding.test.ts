import { describe, expect, it } from 'vitest'
import { decodeAscii, decodeUtf8, encodeAscii, encodeUtf8 } from './utf8'
import { decodeMailboxName, encodeMailboxName } from './utf7'

describe('UTF-8', () => {
  const samples = ['', 'plain', 'Grüße aus München ✓', '日本語 テスト', '😀 pair', 'a\u0000b', 'é'.repeat(50)]

  it('encodes the way TextEncoder does', () => {
    for (const text of samples) {
      expect([...encodeUtf8(text)]).toEqual([...new TextEncoder().encode(text)])
    }
  })

  it('decodes what it encodes', () => {
    for (const text of samples) expect(decodeUtf8(encodeUtf8(text))).toBe(text)
  })

  // A lone surrogate is not a character. TextEncoder writes U+FFFD for it, and so does this.
  it('writes a lone surrogate as the replacement character', () => {
    expect([...encodeUtf8('a\ud800b')]).toEqual([...new TextEncoder().encode('a\ud800b')])
  })

  // Not a handful of hand picked cases. Damaged input is the case that matters, and the standard
  // is exact about how many replacement characters it earns, so the answer is compared against
  // the one Node gives over a large number of random byte strings.
  it('decodes damaged input exactly like TextDecoder', () => {
    const reference = new TextDecoder('utf-8')
    let seed = 12345
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed
    }
    // Weighted towards the bytes that start and continue multi byte sequences.
    const interesting = [0x00, 0x41, 0x7f, 0x80, 0x8f, 0x90, 0x9f, 0xa0, 0xbf, 0xc0, 0xc1, 0xc2, 0xdf, 0xe0, 0xe1, 0xed, 0xee, 0xef, 0xf0, 0xf1, 0xf4, 0xf5, 0xff]
    for (let round = 0; round < 20000; round++) {
      const length = next() % 9
      const bytes = new Uint8Array(length)
      for (let i = 0; i < length; i++) {
        bytes[i] = next() % 3 === 0 ? next() % 256 : interesting[next() % interesting.length]
      }
      expect(decodeUtf8(bytes), `bytes ${[...bytes].map((b) => b.toString(16)).join(' ')}`).toBe(
        reference.decode(bytes)
      )
    }
  })

  it('reads a cut off character as one replacement', () => {
    expect(decodeUtf8(Uint8Array.from([0x61, 0xe2, 0x82]))).toBe('a�')
  })
})

describe('ASCII', () => {
  it('goes both ways', () => {
    expect(decodeAscii(encodeAscii('A1 OK done'))).toBe('A1 OK done')
  })

  it('refuses a character that is not a byte', () => {
    expect(() => encodeAscii('Grüße ✓')).toThrow(/Not a byte/)
  })
})

describe('modified UTF-7 mailbox names', () => {
  // The two worked examples of RFC 3501, and the names recorded from Dovecot.
  const pairs: [string, string][] = [
    ['INBOX', 'INBOX'],
    ['Entwürfe', 'Entw&APw-rfe'],
    ['Projekte & Pläne', 'Projekte &- Pl&AOQ-ne'],
    ['~peter/mail/台北/日本語', '~peter/mail/&U,BTFw-/&ZeVnLIqe-'],
    ['Sent & Gesendet', 'Sent &- Gesendet'],
    ['😀', '&2D3eAA-'],
    ['', '']
  ]

  it('encodes to the same text as the specification and the server', () => {
    for (const [plain, encoded] of pairs) expect(encodeMailboxName(plain)).toBe(encoded)
  })

  it('decodes it again', () => {
    for (const [plain, encoded] of pairs) expect(decodeMailboxName(encoded)).toBe(plain)
  })

  it('round trips names that mix scripts and punctuation', () => {
    for (const name of ['Archiv.2026', 'a&b&c', 'ÄÖÜ&äöü', 'ñ', 'x–y', '日本語.メール']) {
      expect(decodeMailboxName(encodeMailboxName(name))).toBe(name)
    }
  })

  // Some servers list names in a plain encoding. Showing them as sent beats failing to list the
  // folder, so what does not decode is returned unchanged.
  it('leaves a name that is not modified UTF-7 alone', () => {
    expect(decodeMailboxName('Entw&-rfe')).toBe('Entw&rfe')
    expect(decodeMailboxName('broken&AOQ')).toBe('broken&AOQ')
    expect(decodeMailboxName('bad&!!!-run')).toBe('bad&!!!-run')
    expect(decodeMailboxName('odd&AO-run')).toBe('odd&AO-run')
  })
})
