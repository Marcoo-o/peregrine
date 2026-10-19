/**
 * Turns a file name that arrived in a message into one that is safe to join onto a directory.
 *
 * The name of an attachment is written by whoever sent the message. It reached `path.join`
 * unchanged, and `join(dir, '../../../x')` leaves the directory it was meant to stay in.
 * Measured against mailparser: `../../escaped.txt` is handed over verbatim, and the same holds
 * for the RFC 2231 and RFC 2047 encoded spellings, because decoding happens before we see it.
 * A name with enough `..` segments reaches anywhere the user can write, the Windows startup
 * folder included, and that turns opening a message into running a program at the next login.
 *
 * The rule here is deliberately not "strip the dangerous parts". Removing `..` from `....//`
 * leaves `../`, which is the classic way such a filter is defeated. Everything that could
 * carry structure is replaced instead, and the result is checked afterwards.
 */

/** Reserved on Windows regardless of extension, and unusable as a file name. */
const RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9'
])

/**
 * Characters that either separate paths or are refused by Windows.
 *
 * The colon is in here for two reasons. It separates a drive letter, and it opens an alternate
 * data stream, which is a way to attach content to a file that most tools never show.
 *
 * Spaces and hyphens are deliberately absent. They are ordinary in a file name, they carry no
 * structure, and replacing them would mangle nearly every real attachment.
 */
const FORBIDDEN = new Set(['/', '\\', ':', '*', '?', '"', '<', '>', '|'])

/**
 * Control characters and delete, which have no business in a file name.
 *
 * Written as a code point test rather than as a range inside a regular expression on purpose.
 * The escape sequences did not survive every tool that touched this file, and what ended up in
 * the source was the control character itself. That is invisible to a reader and makes the file
 * count as binary to grep and to diff. It happened here once already and was only found by
 * dumping the code points, so the shape that cannot go wrong is the one worth keeping.
 */
function isControlCharacter(character: string): boolean {
  const code = character.codePointAt(0) ?? 0
  return code < 0x20 || code === 0x7f
}

function replaceForbidden(name: string): string {
  return Array.from(name, (character) =>
    FORBIDDEN.has(character) || isControlCharacter(character) ? '_' : character
  ).join('')
}

/** How long a single name may be. Well under the limit, and long enough to stay readable. */
const MAX_LENGTH = 120

/**
 * @param proposed the name as it arrived, or nothing when the message carried none
 * @param fallback used when nothing usable is left, normally the attachment id
 */
export function safeFilename(proposed: string | null | undefined, fallback: string): string {
  const cleaned = replaceForbidden(proposed ?? '')
    // Leading dots would produce `.` and `..`, and a name that starts with one is hidden on
    // Unix. Only the leading ones go, so `report.2026.pdf` keeps its shape.
    .replace(/^\.+/, '')
    // Windows silently drops trailing dots and spaces, which would let `evil.exe.` become
    // `evil.exe` after the check rather than before it.
    .replace(/[. ]+$/, '')
    .trim()

  if (cleaned === '') return fallback

  const stem = cleaned.split('.')[0].toLowerCase()
  if (RESERVED.has(stem)) return `_${cleaned}`

  if (cleaned.length <= MAX_LENGTH) return cleaned

  // Shortened from the front rather than the back, so the extension survives. A name whose
  // extension was cut off would be opened by the wrong program, or by none.
  const dot = cleaned.lastIndexOf('.')
  const extension = dot > 0 ? cleaned.slice(dot, dot + 12) : ''
  return cleaned.slice(0, MAX_LENGTH - extension.length) + extension
}

/**
 * Whether a resolved path really lies inside the directory it was built from.
 *
 * The belt to the braces above. Anything that changes how names are cleaned has to keep this
 * true, and a caller that forgets `safeFilename` is caught here rather than at the file system.
 *
 * Compared against `directory` plus the separator, so a sibling directory whose name merely
 * starts the same way does not pass.
 */
export function isInside(directory: string, candidate: string, separator: string): boolean {
  const base = directory.endsWith(separator) ? directory : directory + separator
  return candidate.startsWith(base)
}
