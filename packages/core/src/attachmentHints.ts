/**
 * Noticing that a message talks about an attachment it does not have.
 *
 * The check runs on what the user wrote, so it belongs here rather than in the composer: it
 * is a rule about language, and rules about language are worth testing on their own.
 *
 * Deliberately narrow. A false alarm costs a dialog on a message that was fine, and someone
 * who sees that twice starts dismissing the dialog without reading it. At which point the
 * warning is worse than none at all. So: only phrases that announce an enclosure, never a
 * bare mention of the word.
 */

/**
 * Phrases that announce an attachment.
 *
 * "Anhang" alone is not one of them. "danke für den Anhang" is a reply about a file that
 * arrived, not a promise of one being sent.
 */
const ANNOUNCEMENTS = [
  // German
  /\banbei\b/i,
  /\bbeigefügt\b/i,
  /\bim\s+anhang\b/i,
  /\bals\s+anhang\b/i,
  /\banhängend\b/i,
  /\bhänge\s+(?:ich\s+)?(?:\w+\s+){0,3}an\b/i,
  // English
  /\battached\b/i,
  /\battaching\b/i,
  /\bplease\s+find\s+enclosed\b/i,
  /\bsee\s+attachment\b/i,
  /\benclosed\b/i
]

/**
 * Quoted lines are not the writer's own words.
 *
 * Replying to a message that said "anbei die Rechnung" would otherwise warn about an
 * attachment the *other* person sent.
 */
function withoutQuotes(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n')
}

/** Strips tags so an HTML body is judged on its text, not its markup. */
function textOf(body: string): string {
  return body
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
}

export function mentionsAttachment(body: string): boolean {
  const text = withoutQuotes(textOf(body))
  return ANNOUNCEMENTS.some((pattern) => pattern.test(text))
}

/** Whether to ask before sending: something was announced, nothing is attached. */
export function shouldWarnAboutAttachment(body: string, attachmentCount: number): boolean {
  return attachmentCount === 0 && mentionsAttachment(body)
}

/**
 * Turns dropped files into attachments.
 *
 * Directories arrive without a usable path in Electron's drop payload and would be sent as
 * empty files, so they are dropped rather than half-handled. Anything already attached is
 * skipped: dropping the same file twice is a slip, not a request for two copies.
 */
export function attachmentsFromPaths(
  paths: string[],
  existingPaths: string[]
): { filename: string; path: string }[] {
  const known = new Set(existingPaths)
  const added: { filename: string; path: string }[] = []
  for (const path of paths) {
    if (path === '' || known.has(path)) continue
    known.add(path)
    added.push({ filename: path.split(/[\\/]/).pop() || path, path })
  }
  return added
}
