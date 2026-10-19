/**
 * The modified UTF-7 of IMAP mailbox names (RFC 3501, section 5.1.3).
 *
 * Printable ASCII stands for itself. Anything else is written as UTF-16, base64 encoded with `,`
 * in place of `/` and without padding, between `&` and `-`. The ampersand itself, which would
 * otherwise start such a run, is written `&-`.
 *
 * Mailbox names are the one place the protocol carries text that is not ASCII in a command, and
 * they are compared byte for byte by the server, so getting this wrong creates a second folder or
 * addresses one that is not there.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+,'

function isDirect(code: number): boolean {
  return code >= 0x20 && code <= 0x7e && code !== 0x26
}

function encodeRun(units: number[]): string {
  const bytes: number[] = []
  for (const unit of units) bytes.push(unit >> 8, unit & 0xff)
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const chunk = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    const characters = bytes.length - i >= 3 ? 4 : bytes.length - i === 2 ? 3 : 2
    for (let n = 0; n < characters; n++) out += ALPHABET[(chunk >> (18 - 6 * n)) & 0x3f]
  }
  return out
}

export function encodeMailboxName(name: string): string {
  let out = ''
  let run: number[] = []
  const flush = (): void => {
    if (run.length > 0) {
      out += '&' + encodeRun(run) + '-'
      run = []
    }
  }
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i)
    if (isDirect(code)) {
      flush()
      out += name[i]
    } else if (code === 0x26) {
      flush()
      out += '&-'
    } else {
      // UTF-16 code units as they come, so a surrogate pair stays a pair.
      run.push(code)
    }
  }
  flush()
  return out
}

/**
 * Decodes a mailbox name. A name that is not valid modified UTF-7 comes back unchanged, because
 * some servers list names in a plain encoding, and showing them as sent is better than failing
 * to list a folder.
 */
export function decodeMailboxName(encoded: string): string {
  let out = ''
  let i = 0
  while (i < encoded.length) {
    const char = encoded[i]
    if (char !== '&') {
      out += char
      i++
      continue
    }
    const end = encoded.indexOf('-', i + 1)
    if (end === -1) return encoded
    const run = encoded.slice(i + 1, end)
    i = end + 1
    if (run === '') {
      out += '&'
      continue
    }
    const bytes: number[] = []
    let bits = 0
    let buffer = 0
    for (const c of run) {
      const value = ALPHABET.indexOf(c)
      if (value === -1) return encoded
      buffer = (buffer << 6) | value
      bits += 6
      if (bits >= 8) {
        bits -= 8
        bytes.push((buffer >> bits) & 0xff)
        buffer &= (1 << bits) - 1
      }
    }
    // Whatever is left over is padding, and padding is zeros. Anything else, or an odd number of
    // bytes, is not a run of UTF-16 units.
    if (buffer !== 0 || bytes.length % 2 !== 0) return encoded
    for (let n = 0; n < bytes.length; n += 2) out += String.fromCharCode((bytes[n] << 8) | bytes[n + 1])
  }
  return out
}
