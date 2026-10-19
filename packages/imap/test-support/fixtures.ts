import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface Exchange {
  direction: 'C' | 'S'
  bytes: Uint8Array
}

/**
 * A recorded conversation with a real server, as a list of what each side sent.
 *
 * The files in `fixtures` are written by a small recorder that connects to Dovecot and keeps every
 * chunk exactly as it arrived, one per line: `S:` or `C:` and then the bytes as a JSON string with
 * one character per byte. Nothing is cleaned up, so these are the responses the parser has to
 * cope with and not the ones its author would have written.
 */
export function loadTranscript(name: string): Exchange[] {
  const file = join(__dirname, '..', 'fixtures', `${name}.out.txt`)
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const direction = line[0] as 'C' | 'S'
      const text = JSON.parse(line.slice(3)) as string
      return { direction, bytes: Uint8Array.from(text, (c) => c.charCodeAt(0)) }
    })
}

export function serverBytes(name: string): Uint8Array {
  const parts = loadTranscript(name)
    .filter((e) => e.direction === 'S')
    .map((e) => e.bytes)
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}
