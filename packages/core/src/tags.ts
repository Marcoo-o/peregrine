/**
 * Tags, stored on the server as IMAP keywords.
 *
 * Keeping them in the mailbox rather than in the local database is what makes them worth
 * having: a tag set here is still there in the webmail and on the phone, and it survives this
 * app being reinstalled. The price is that a tag has to be expressible as an IMAP keyword,
 * which is a good deal more restrictive than a label a user would type.
 */

export interface Tag {
  id: string
  /** What the user typed and sees. */
  name: string
  /** The IMAP keyword actually stored on the server. */
  keyword: string
  color: string
  sortOrder: number
}

/**
 * Characters IMAP forbids in a keyword.
 *
 * An IMAP flag is an "atom", which rules out the list separators, quoting and wildcard
 * characters as well as anything non-printable. Sending one anyway does not fail cleanly.
 * Servers differ between rejecting the command, silently dropping the flag, or storing
 * something subtly different. So the keyword is derived rather than passed through.
 */
const FORBIDDEN = /[(){}[\]%*"\\\s\x00-\x1f\x7f]/g

/**
 * Turns a name into a valid keyword.
 *
 * Accents are folded rather than stripped so "Für später" stays recognisable as "Fuer_spaeter"
 * instead of collapsing to "F_r_sp_ter". Servers vary in how they handle non-ASCII keywords,
 * and a tag that reads as line noise in another client is worse than one that lost its umlauts.
 */
export function keywordFor(name: string): string {
  const folded = name
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae')
    .replace(/Ö/g, 'Oe')
    .replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
    // Decompose the rest and drop the accents: é → e, ñ → n.
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

  const cleaned = folded.replace(FORBIDDEN, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
  // A name made entirely of forbidden characters would otherwise yield an empty keyword,
  // which no server accepts.
  return cleaned === '' ? 'Tag' : cleaned.slice(0, 64)
}

/** System flags are not tags; they have their own meaning and their own controls. */
const SYSTEM_FLAGS = new Set([
  '\\seen',
  '\\answered',
  '\\flagged',
  '\\deleted',
  '\\draft',
  '\\recent',
  '$forwarded',
  '$junk',
  '$notjunk',
  '$phishing',
  '$mdnsent'
])

export function isTagKeyword(flag: string): boolean {
  if (flag.startsWith('\\')) return false
  return !SYSTEM_FLAGS.has(flag.toLowerCase())
}

/** The keywords on a message that are tags, from its stored flag list. */
export function tagKeywordsOf(flags: string[]): string[] {
  return flags.filter(isTagKeyword)
}

export function parseFlags(json: string | null): string[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.filter((f): f is string => typeof f === 'string') : []
  } catch {
    return []
  }
}

/** Colours offered for a new tag; the same palette the accent colours are drawn from. */
export const TAG_COLORS = [
  '#b03d33',
  '#a2650c',
  '#5c7a12',
  '#2a7a4f',
  '#16736b',
  '#0f6d87',
  '#2f5d9f',
  '#43499b',
  '#6341b8',
  '#97379a',
  '#b03a5b',
  '#4a5765'
]
