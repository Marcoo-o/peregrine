import { simpleParser, type ParsedMail } from 'mailparser'

/**
 * Turns parsed headers into the blob stored in `messages.headers_json`.
 *
 * The shape matters: `parseReplyTo` and `parseAuthResultsHeader` in the repository read this
 * back, and they expect mailparser's own keys. Lower case, addresses as objects, repeated
 * headers as arrays. Writing the same JSON everywhere is what keeps them working.
 */
export function headersJson(headers: ParsedMail['headers'] | undefined): string {
  return JSON.stringify(headers ? Object.fromEntries(headers) : {})
}

/**
 * Reads the envelope headers of a message whose body must not be unwrapped.
 *
 * Used for PGP messages: those are stored as they arrived, so nothing else parses them, but
 * Reply-To and Authentication-Results are read from the header blob all the same. Both
 * travelled in the clear. Leaving them out protected nothing and only switched two checks off
 * on the messages that look most trustworthy.
 *
 * A message that cannot be parsed yields empty headers rather than an error: for a PGP message
 * the source is what matters, and no headers costs only those two extra checks.
 */
export async function headersJsonOf(source: Buffer): Promise<string> {
  try {
    return headersJson((await simpleParser(source)).headers)
  } catch (err) {
    console.error('reading the headers of a PGP message failed:', err)
    return '{}'
  }
}
