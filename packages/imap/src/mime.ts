import { decodeUtf8 } from './utf8'

/**
 * Header text that carries more than ASCII, as RFC 2047 writes it: `=?UTF-8?B?R3LDvMOfZQ==?=`.
 *
 * The server hands envelope fields over as they stand in the message, so a subject with an umlaut
 * arrives encoded and somebody has to decode it. imapflow did that through libmime. This does the
 * same for the charsets that matter in practice, and asks the platform for the rest.
 */

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function decodeBase64(text: string): Uint8Array {
  const out: number[] = []
  let bits = 0
  let buffer = 0
  for (const c of text) {
    if (c === '=') break
    const value = BASE64.indexOf(c)
    // Whitespace and anything else that is not part of the alphabet is skipped, as mail software
    // wraps and mangles base64 in all sorts of ways.
    if (value === -1) continue
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((buffer >> bits) & 0xff)
      buffer &= (1 << bits) - 1
    }
  }
  return Uint8Array.from(out)
}

export function encodeBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const chunk = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    const remaining = bytes.length - i
    out += BASE64[(chunk >> 18) & 0x3f] + BASE64[(chunk >> 12) & 0x3f]
    out += remaining > 1 ? BASE64[(chunk >> 6) & 0x3f] : '='
    out += remaining > 2 ? BASE64[chunk & 0x3f] : '='
  }
  return out
}

/** The "Q" encoding: quoted-printable with an underscore for the space. */
function decodeQ(text: string): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '_') out.push(0x20)
    else if (c === '=' && /^[0-9a-fA-F]{2}$/.test(text.slice(i + 1, i + 3))) {
      out.push(parseInt(text.slice(i + 1, i + 3), 16))
      i += 2
    } else out.push(c.charCodeAt(0) & 0xff)
  }
  return Uint8Array.from(out)
}

// windows-1252 differs from ISO-8859-1 in the 0x80 to 0x9f range, where it has printable
// characters. 0 marks the five bytes it leaves undefined.
const CP1252 = [
  0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039,
  0x0152, 0, 0x017d, 0, 0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc,
  0x2122, 0x0161, 0x203a, 0x0153, 0, 0x017e, 0x0178
]

// ISO-8859-15 is Latin-1 with eight characters swapped, most famously the euro sign.
const LATIN9: Record<number, number> = {
  0xa4: 0x20ac, 0xa6: 0x0160, 0xa8: 0x0161, 0xb4: 0x017d, 0xb8: 0x017e, 0xbc: 0x0152, 0xbd: 0x0153, 0xbe: 0x0178
}

function decodeSingleByte(bytes: Uint8Array, map: (byte: number) => number): string {
  let out = ''
  for (const byte of bytes) out += String.fromCharCode(map(byte))
  return out
}

interface DecoderConstructor {
  new (label: string): { decode(bytes: Uint8Array): string }
}

function platformDecode(charset: string, bytes: Uint8Array): string | null {
  const Decoder = (globalThis as { TextDecoder?: DecoderConstructor }).TextDecoder
  if (!Decoder) return null
  try {
    return new Decoder(charset).decode(bytes)
  } catch {
    // The platform does not know the label.
    return null
  }
}

/**
 * Bytes in a named charset, as text. The common ones are done here so they work everywhere. The
 * rest go to the platform's decoder, and where there is none the bytes are read as Latin-1, which
 * keeps the ASCII part readable instead of losing the whole word.
 */
export function decodeCharset(charset: string, bytes: Uint8Array): string {
  const name = charset.toLowerCase().replace(/\*.*$/, '')
  switch (name) {
    case 'utf-8':
    case 'utf8':
      return decodeUtf8(bytes)
    case 'us-ascii':
    case 'ascii':
    case 'iso-8859-1':
    case 'iso8859-1':
    case 'latin1':
    case 'l1':
      return decodeSingleByte(bytes, (b) => b)
    case 'iso-8859-15':
    case 'latin9':
      return decodeSingleByte(bytes, (b) => LATIN9[b] ?? b)
    case 'windows-1252':
    case 'cp1252':
      return decodeSingleByte(bytes, (b) => (b >= 0x80 && b <= 0x9f ? CP1252[b - 0x80] || b : b))
    default:
      return platformDecode(name, bytes) ?? decodeSingleByte(bytes, (b) => b)
  }
}

const ENCODED_WORD = /=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/g

/**
 * Replaces every encoded word in a piece of header text by what it says.
 *
 * Two details of the specification matter. Whitespace between two encoded words is not part of
 * the text and is dropped, which is how a long subject split over several words reads as one. And
 * consecutive words in the same charset are decoded together, because some software cuts a
 * multi byte character across two of them, which no single word could decode on its own.
 */
export function decodeMimeWords(text: string): string {
  if (!text.includes('=?')) return text

  let out = ''
  let last = 0
  let run: { charset: string; bytes: number[] } | null = null
  const flush = (): void => {
    if (run) out += decodeCharset(run.charset, Uint8Array.from(run.bytes))
    run = null
  }

  for (const match of text.matchAll(ENCODED_WORD)) {
    const index = match.index ?? 0
    const between = text.slice(last, index)
    const charset = match[1]
    const bytes =
      match[2].toLowerCase() === 'b' ? decodeBase64(match[3]) : decodeQ(match[3])

    if (run && /^\s*$/.test(between) && run.charset.toLowerCase() === charset.toLowerCase()) {
      run.bytes.push(...bytes)
    } else if (run && /^\s*$/.test(between)) {
      // A different charset follows: the run is finished, the whitespace still is not text.
      flush()
      run = { charset, bytes: [...bytes] }
    } else {
      flush()
      out += between
      run = { charset, bytes: [...bytes] }
    }
    last = index + match[0].length
  }
  flush()
  return out + text.slice(last)
}
