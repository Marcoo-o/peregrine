import { decodeAscii } from '@peregrine/imap/utf8'
import { SmtpError } from './errors'

/** One reply of the server: a three digit code and the lines of text that came with it. */
export interface Reply {
  code: number
  /** Without the code. A reply of several lines has one entry for each. */
  lines: string[]
}

/**
 * The longest line taken before giving up on it. The standard allows 512 bytes for a reply line
 * and extensions stretch that, so this is generous, and still small enough that a server which
 * never ends a line cannot make the client collect it forever.
 */
const MAX_LINE = 4096
/** The most lines in one reply. The extension list of a large server is a few dozen. */
const MAX_LINES = 200

/**
 * Turns what the server sends into replies, however it arrives in pieces.
 *
 * A reply is one or more lines that start with the same code. Every line but the last has a hyphen
 * after the code, the last has a space or nothing: `250-SIZE 100`, then `250 OK`. A server may end
 * its lines with a bare line feed, which the standard does not allow and many do, so both are taken.
 * Anything that is not that is a protocol error, and not guessed at: a client that carries on after
 * a reply it did not understand is a client that answers the wrong question.
 *
 * The bytes are read as Latin-1, which keeps every one of them and so loses nothing. The text of a
 * reply is for people and the diagnostics log, and the code is ASCII.
 */
export class ReplyReader {
  private buffer = ''
  private code: number | null = null
  private lines: string[] = []

  /** Adds what arrived and returns the replies that are complete now, in order. */
  push(bytes: Uint8Array): Reply[] {
    this.buffer += decodeAscii(bytes)
    const done: Reply[] = []
    for (;;) {
      const newline = this.buffer.indexOf('\n')
      if (newline === -1) {
        if (this.buffer.length > MAX_LINE) {
          throw new SmtpError('protocol', 'The server sent a line that does not end')
        }
        return done
      }
      let line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      if (line.endsWith('\r')) line = line.slice(0, -1)
      if (line.length > MAX_LINE) throw new SmtpError('protocol', 'The server sent a line that is too long')
      const reply = this.take(line)
      if (reply) done.push(reply)
    }
  }

  /**
   * Forgets what was received and not yet understood. After STARTTLS, whatever the clear connection
   * delivered was sent before the encryption and cannot be believed.
   */
  reset(): void {
    this.buffer = ''
    this.code = null
    this.lines = []
  }

  private take(line: string): Reply | null {
    const match = /^(\d{3})(?:([ -])(.*))?$/.exec(line)
    if (!match) throw new SmtpError('protocol', `Not an SMTP reply: ${printable(line)}`)
    const code = Number(match[1])
    if (this.code !== null && code !== this.code) {
      throw new SmtpError('protocol', `A reply changed its code from ${this.code} to ${code}`)
    }
    this.code = code
    this.lines.push(match[3] ?? '')
    if (this.lines.length > MAX_LINES) throw new SmtpError('protocol', 'The server sent too long a reply')
    // A hyphen means more is coming. A space, or nothing at all, ends it.
    if (match[2] === '-') return null
    const reply = { code, lines: this.lines }
    this.code = null
    this.lines = []
    return reply
  }
}

/** A line as it can go into a message that a person reads: short, and without control characters. */
function printable(line: string): string {
  const shown = line.slice(0, 60).replace(/[^\x20-\x7e]/g, '?')
  return line.length > 60 ? `${shown}…` : shown
}
