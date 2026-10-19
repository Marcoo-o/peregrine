/**
 * Splits a raw message into the parts worth telling apart on screen.
 *
 * Hand written rather than a syntax highlighting library. The grammar is four line shapes,
 * every library capable of this ships a megabyte of parsers for languages a mail client will
 * never show, and each of them wants to inject its own markup, which is the one thing a
 * program that renders foreign mail should be slowest to allow.
 */

export type MailLineKind =
  | 'headerName'
  | 'continuation'
  | 'boundary'
  | 'blank'
  | 'encoded'
  | 'body'

export interface MailLine {
  kind: MailLineKind
  /** Set for a header line: everything before the colon. */
  name?: string
  /** The rest of the line, or the whole of it where there is no name. */
  text: string
}

/** A header name per RFC 5322: printable ASCII without the colon, and never empty. */
const HEADER = /^([!-9;-~]+):[ \t]?(.*)$/

/**
 * Base64 and quoted-printable, recognised well enough to dim them.
 *
 * Deliberately loose. Getting it wrong costs a line that is grey instead of black, and a
 * strict parser would need the part's declared encoding, which means parsing MIME rather
 * than looking at a line.
 */
const BASE64 = /^[A-Za-z0-9+/]{60,}={0,2}$/
const QUOTED_PRINTABLE = /=[0-9A-F]{2}/

export function highlightMailSource(source: string): MailLine[] {
  const lines: MailLine[] = []
  // Headers only count as headers before the first blank line. After it, a line reading
  // "From: someone" is quoted text inside the body, not a header of this message.
  let inHeaders = true

  for (const raw of source.replace(/\r\n/g, '\n').split('\n')) {
    if (raw === '') {
      lines.push({ kind: 'blank', text: '' })
      inHeaders = false
      continue
    }

    // A MIME boundary opens a part, and its headers start again after it.
    if (raw.startsWith('--') && raw.length > 2) {
      lines.push({ kind: 'boundary', text: raw })
      inHeaders = true
      continue
    }

    if (inHeaders) {
      if (raw.startsWith(' ') || raw.startsWith('\t')) {
        lines.push({ kind: 'continuation', text: raw })
        continue
      }
      const match = HEADER.exec(raw)
      if (match) {
        lines.push({ kind: 'headerName', name: match[1], text: match[2] })
        continue
      }
      // Something that is neither: the header block has ended without a blank line, which
      // happens in messages that were assembled by hand.
      inHeaders = false
    }

    const encoded = BASE64.test(raw) || QUOTED_PRINTABLE.test(raw)
    lines.push({ kind: encoded ? 'encoded' : 'body', text: raw })
  }

  // A trailing newline produces one empty entry at the end, which would draw a blank row.
  if (lines.length > 0 && lines[lines.length - 1].kind === 'blank') lines.pop()
  return lines
}
