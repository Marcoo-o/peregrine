/**
 * UTF-8 in both directions, written out.
 *
 * `TextEncoder` and `TextDecoder` exist in Node and Electron, and not everywhere the client has
 * to run. The protocol is mostly ASCII, but a server may send an 8-bit header raw inside a
 * literal, and a mailbox name or a search string may need encoding, so both directions are
 * needed and neither can lean on a global that may be missing.
 */

const REPLACEMENT = 0xfffd

export function encodeUtf8(text: string): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i)
    // A surrogate pair is one character. A lone half is not a character at all, and becomes the
    // replacement character rather than invalid bytes.
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00)
        i++
      } else {
        code = REPLACEMENT
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      code = REPLACEMENT
    }

    if (code < 0x80) out.push(code)
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      )
    }
  }
  return Uint8Array.from(out)
}

/**
 * Decodes UTF-8, replacing anything invalid with U+FFFD instead of failing.
 *
 * A header from a stranger is not trusted to be well formed, and one bad byte must not make a
 * whole message unreadable. This is the algorithm of the Encoding Standard, which is what every
 * browser and Node do, down to how many replacement characters a damaged sequence earns: one for
 * each maximal run of bytes that could have started a valid character.
 */
export function decodeUtf8(bytes: Uint8Array): string {
  let out = ''
  let needed = 0
  let seen = 0
  let code = 0
  let lower = 0x80
  let upper = 0xbf

  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]
    if (needed === 0) {
      if (byte < 0x80) {
        out += String.fromCharCode(byte)
      } else if (byte >= 0xc2 && byte <= 0xdf) {
        needed = 1
        code = byte & 0x1f
      } else if (byte >= 0xe0 && byte <= 0xef) {
        if (byte === 0xe0) lower = 0xa0
        if (byte === 0xed) upper = 0x9f
        needed = 2
        code = byte & 0x0f
      } else if (byte >= 0xf0 && byte <= 0xf4) {
        if (byte === 0xf0) lower = 0x90
        if (byte === 0xf4) upper = 0x8f
        needed = 3
        code = byte & 0x07
      } else {
        out += String.fromCharCode(REPLACEMENT)
      }
      continue
    }

    if (byte < lower || byte > upper) {
      // Not a continuation that fits. The run so far is one replacement, and this byte gets
      // another look as the start of whatever comes next.
      code = 0
      needed = 0
      seen = 0
      lower = 0x80
      upper = 0xbf
      out += String.fromCharCode(REPLACEMENT)
      i--
      continue
    }

    lower = 0x80
    upper = 0xbf
    code = (code << 6) | (byte & 0x3f)
    seen++
    if (seen === needed) {
      out += code >= 0x10000 ? String.fromCodePoint(code) : String.fromCharCode(code)
      code = 0
      needed = 0
      seen = 0
    }
  }
  // Input that ends in the middle of a character.
  if (needed !== 0) out += String.fromCharCode(REPLACEMENT)
  return out
}

/** Bytes as text, one byte to one character. For protocol keywords, which are ASCII. */
export function decodeAscii(bytes: Uint8Array, start = 0, end = bytes.length): string {
  let out = ''
  for (let i = start; i < end; i++) out += String.fromCharCode(bytes[i])
  return out
}

/** The other way round. A character above 0xff cannot be one byte, and is refused. */
export function encodeAscii(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code > 0xff) throw new Error(`Not a byte: U+${code.toString(16)} at ${i}`)
    out[i] = code
  }
  return out
}
