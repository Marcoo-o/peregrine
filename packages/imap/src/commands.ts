import { encodeMailboxName } from './utf7'
import { encodeUtf8 } from './utf8'

/**
 * Building the client's side of the conversation.
 *
 * Whatever goes into a command can come from somewhere that is not trusted: a flag is the tag a
 * correspondent's client set, a folder name is whatever the server lists, a password is anything
 * the user typed. A command is text with a line break at the end, so a value that carries one
 * could end the command early and start another. Nothing here lets a value become part of the
 * syntax: it is either checked against what it may look like, or sent as a literal, whose length
 * is announced first and whose content is then not read as protocol at all.
 */

export interface Literal {
  literal: Uint8Array
}

/** After the server's next continuation request, send this line. For SASL exchanges. */
export interface Answer {
  answer: string
}

/** One piece of a command: text that goes out as it is, a literal, or a reply to a challenge. */
export type Arg = string | Literal | Answer

export function isLiteral(arg: Arg): arg is Literal {
  return typeof arg === 'object' && 'literal' in arg
}

export function isAnswer(arg: Arg): arg is Answer {
  return typeof arg === 'object' && 'answer' in arg
}

export function literal(data: Uint8Array | string): Literal {
  return { literal: typeof data === 'string' ? encodeUtf8(data) : data }
}

// Atom characters: anything printable and ASCII except the specials of the grammar.
const ATOM = /^[^\x00-\x20\x7f-￿(){%*"\\\]]+$/
// What can sit inside a quoted string without a literal: printable ASCII and nothing that ends a line.
const QUOTABLE = /^[\x20-\x7e]*$/

/**
 * A string argument in the shortest form that is safe: bare if it is an atom, quoted if it is
 * printable ASCII, a literal otherwise. The last covers non-ASCII text and anything with a control
 * character in it, line breaks included.
 */
export function astring(text: string): Arg {
  if (ATOM.test(text)) return text
  if (QUOTABLE.test(text)) return quote(text)
  return literal(text)
}

export function quote(text: string): string {
  if (!QUOTABLE.test(text)) throw new Error('Not representable as a quoted string')
  return `"${text.replace(/[\\"]/g, '\\$&')}"`
}

/** A mailbox name, in its modified UTF-7 form and always quoted. */
export function mailbox(path: string): string {
  return quote(encodeMailboxName(path))
}

/**
 * A list of flags. Each has to look like a flag, because this is where a value that came from a
 * message's tags would otherwise be pasted into the command.
 */
export function flagList(flags: readonly string[]): string {
  for (const flag of flags) {
    if (!/^\\?[^\x00-\x20\x7f-￿(){%*"\\\]]+$/.test(flag)) {
      throw new Error(`Not a flag: ${JSON.stringify(flag)}`)
    }
  }
  return `(${flags.join(' ')})`
}

/** `1,2,3,5,7,8` as `1:3,5,7:8`: a UID set as short as it can be written. */
export function sequenceSet(numbers: readonly number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b)
  if (sorted.length === 0) throw new Error('An empty set of messages')
  const parts: string[] = []
  let from = sorted[0]
  let to = sorted[0]
  const close = (): void => {
    parts.push(from === to ? String(from) : `${from}:${to}`)
  }
  for (const n of sorted.slice(1)) {
    if (!Number.isInteger(n) || n < 1) throw new Error(`Not a message number: ${n}`)
    if (n === to + 1) {
      to = n
    } else {
      close()
      from = n
      to = n
    }
  }
  if (!Number.isInteger(sorted[0]) || sorted[0] < 1) throw new Error(`Not a message number: ${sorted[0]}`)
  close()
  return parts.join(',')
}

/** The reverse, for the sets a server answers with: `1:3,5` as `[1, 2, 3, 5]`, in the order written. */
export function expandSequenceSet(text: string, limit = 1_000_000): number[] {
  const out: number[] = []
  for (const part of text.split(',')) {
    const match = /^(\d+)(?::(\d+))?$/.exec(part.trim())
    if (!match) throw new Error(`Not a sequence set: ${text}`)
    const a = Number(match[1])
    const b = match[2] === undefined ? a : Number(match[2])
    const step = a <= b ? 1 : -1
    for (let n = a; step > 0 ? n <= b : n >= b; n += step) {
      out.push(n)
      if (out.length > limit) throw new Error('Sequence set is too large')
    }
  }
  return out
}
