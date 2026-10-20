/** What went wrong, as the library or the platform wrote it: the message of an error, or whatever else was thrown. */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * What a network error means, for the ones whose cause is certain from how they are worded. The rest
 * is not guessed at: a reason that is wrong sends somebody looking in the wrong place.
 */
const MEANINGS: { pattern: RegExp; meaning: string }[] = [
  {
    pattern: /not connected|connection (is |was )?closed|closed by peer|broken pipe|connection reset|stopped answering/i,
    meaning: 'Die Verbindung zum Server wurde getrennt.'
  },
  {
    pattern: /refused|failed to connect|unreachable|no route to host|unable to resolve|unknown host|nodename nor servname/i,
    meaning: 'Der Server ist nicht erreichbar.'
  },
  {
    pattern: /did not greet in time|timed? ?out/i,
    meaning: 'Der Server antwortet nicht.'
  },
  {
    pattern: /certificate|handshake|hostname .* not verified|ssl/i,
    meaning: 'Die verschlüsselte Verbindung konnte nicht aufgebaut werden.'
  }
]

/**
 * What went wrong, as a line for a screen: in German when the cause is plain, with the original text
 * after it in brackets for whoever has to look it up, and as it was written when it is not.
 */
export function explainError(error: unknown): string {
  const original = describeError(error)
  const known = MEANINGS.find(({ pattern }) => pattern.test(original))
  return known ? `${known.meaning} (${original})` : original
}
