const CR = 13
const LF = 10
const DOT = 46

/**
 * The message as it goes over the wire after `DATA`: every line ends in CR LF, a line that starts
 * with a dot gets a second one, and the whole ends with a line that is a dot alone.
 *
 * Those are two protections in one. The dot is how the server knows where the message ends, and a
 * message that contains a line of just a dot would end itself early, with whatever follows read as
 * commands. Doubling it, which the server undoes, is what keeps a message from doing that. The line
 * ends are the other half: a bare line feed or a bare carriage return is not a line end to every
 * server, and one that reads it differently from another is how a message gets split in two on the
 * way, which has been used to send mail in a sender's name. So a bare one becomes CR LF, and no
 * server has to decide.
 *
 * The bytes are taken as they are otherwise. A signed or encrypted message passes through whole.
 * It was written with CR LF to begin with, which is the only way a signature over it holds.
 */
export function prepareData(source: Uint8Array): Uint8Array {
  const length = transform(source, null)
  const out = new Uint8Array(length)
  transform(source, out)
  return out
}

/** True when a byte beyond ASCII is in it, which a server has to have said it takes. */
export function hasEightBit(source: Uint8Array): boolean {
  for (let i = 0; i < source.length; i++) if (source[i] > 127) return true
  return false
}

/** Writes into `out` when there is one, and counts when there is not. Returns the length. */
function transform(source: Uint8Array, out: Uint8Array | null): number {
  let n = 0
  const put = (byte: number): void => {
    if (out) out[n] = byte
    n++
  }
  let atLineStart = true
  for (let i = 0; i < source.length; i++) {
    const byte = source[i]
    if (byte === CR) {
      // CR LF is one line end. A CR on its own is one too, and is written out as CR LF.
      if (source[i + 1] === LF) i++
      put(CR)
      put(LF)
      atLineStart = true
    } else if (byte === LF) {
      put(CR)
      put(LF)
      atLineStart = true
    } else {
      if (atLineStart && byte === DOT) put(DOT)
      put(byte)
      atLineStart = false
    }
  }
  // The last line has to be ended before the dot that ends the message can stand on a line of its own.
  if (!atLineStart) {
    put(CR)
    put(LF)
  }
  put(DOT)
  put(CR)
  put(LF)
  return n
}
