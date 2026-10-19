/**
 * What the mail server already decided about a message.
 *
 * Every serious mail server runs a spam filter and writes the result into the headers. That
 * verdict is worth showing, and it is the only one worth trusting: the filter saw the
 * delivering IP, the envelope and the connection, none of which survive into what a client
 * fetches afterwards. A client rebuilding the judgement from a stored copy would be guessing
 * from strictly less evidence.
 *
 * Deliberately no blocklist lookups of our own. Asking a public DNS blocklist about a sender
 * means telling its operator who writes to this mailbox and when, which is exactly the sort of
 * reporting the reading pane blocks remote images to prevent.
 */

/** How the score relates to the threshold the server itself uses. */
export type SpamVerdict = 'clean' | 'borderline' | 'spam'

export interface SpamSymbol {
  /** The filter's own name for the finding, e.g. `FORGED_SENDER`. */
  name: string
  /** What it contributed. Negative values argue for the message being legitimate. */
  score: number
}

export interface SpamAssessment {
  verdict: SpamVerdict
  /** The raw score the server gave, on its own scale. */
  score: number
  /** The score at which that server calls something spam. */
  threshold: number
  /**
   * `score / threshold`, so servers using different scales can be compared. 1 means the
   * server's own limit was reached exactly.
   */
  ratio: number
  /** The findings that pushed the score up, largest first. Empty when none were listed. */
  symbols: SpamSymbol[]
  /** Which filter produced this, for saying where the number comes from. */
  source: 'rspamd' | 'spamassassin' | 'flag'
}

/** Headers as stored: lower-cased keys, values already strings. */
export type HeaderBag = Record<string, unknown>

function header(headers: HeaderBag, name: string): string | null {
  const value = headers[name]
  if (typeof value === 'string') return value
  // A repeated header arrives as an array; the first one is the one the last hop wrote.
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return null
}

/**
 * Rspamd, as mailcow and most self-hosted setups ship it.
 *
 * `default: False [9.76 / 15.00]; SYMBOL(1.50)[detail]; OTHER(-0.10)[]`
 *
 * The brackets after each symbol hold the detail the filter matched on and are skipped: they
 * carry the recipient domain and internal identifiers, which is more than a score display
 * needs and more than belongs on screen.
 */
function parseRspamd(value: string): SpamAssessment | null {
  const head = /\[\s*(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)\s*\]/.exec(value)
  if (!head) return null
  const score = Number(head[1])
  const threshold = Number(head[2])
  if (!Number.isFinite(score) || !Number.isFinite(threshold) || threshold <= 0) return null

  const symbols: SpamSymbol[] = []
  const pattern = /([A-Z][A-Z0-9_]{2,})\((-?\d+(?:\.\d+)?)\)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(value)) !== null) {
    const symbolScore = Number(match[2])
    // Zero-weight symbols are the filter's notes to itself, not reasons.
    if (symbolScore !== 0) symbols.push({ name: match[1], score: symbolScore })
  }

  return { ...classify(score, threshold), symbols: rank(symbols), source: 'rspamd' }
}

/**
 * SpamAssassin, the other one in wide use.
 *
 * `Yes, score=5.2 required=5.0 tests=BAYES_99,URIBL_BLACK autolearn=no`
 *
 * The test names carry no individual scores here, so they are listed without one rather than
 * invented. A name alone still says more than a bare number.
 */
function parseSpamAssassin(value: string): SpamAssessment | null {
  const score = /score=(-?\d+(?:\.\d+)?)/.exec(value)
  const required = /required=(-?\d+(?:\.\d+)?)/.exec(value)
  if (!score || !required) return null
  const threshold = Number(required[1])
  if (threshold <= 0) return null

  const tests = /tests=([A-Z0-9_,]+)/.exec(value)
  const symbols = (tests?.[1].split(',') ?? [])
    .filter((name) => name && name !== 'none')
    .map((name) => ({ name, score: 0 }))

  return { ...classify(Number(score[1]), threshold), symbols, source: 'spamassassin' }
}

function classify(
  score: number,
  threshold: number
): { verdict: SpamVerdict; score: number; threshold: number; ratio: number } {
  const ratio = score / threshold
  // Half the server's own threshold is where a message stops looking ordinary. Below that
  // nothing is shown at all, because a score on every message is a score nobody reads.
  const verdict: SpamVerdict = ratio >= 1 ? 'spam' : ratio >= 0.5 ? 'borderline' : 'clean'
  return { verdict, score, threshold, ratio }
}

/** Largest contribution first, and only what argued against the message. */
function rank(symbols: SpamSymbol[]): SpamSymbol[] {
  return symbols.filter((s) => s.score > 0).sort((a, b) => b.score - a.score)
}

/**
 * Reads whatever verdict the headers carry.
 *
 * The scored formats are tried first. A bare flag is the fallback: it says spam or not and
 * nothing else, so it is reported as exactly at the threshold rather than given a number it
 * never had.
 */
export function assessSpam(headers: HeaderBag): SpamAssessment | null {
  const rspamd = header(headers, 'x-spamd-result')
  if (rspamd) {
    const parsed = parseRspamd(rspamd)
    if (parsed) return parsed
  }

  const status = header(headers, 'x-spam-status')
  if (status) {
    const parsed = parseSpamAssassin(status)
    if (parsed) return parsed
  }

  // Some servers write only the number, with no threshold to compare it against. Five is
  // SpamAssassin's default and the convention nearly everything else copied.
  const bare = header(headers, 'x-spam-score') ?? header(headers, 'x-rspamd-score')
  if (bare) {
    const score = Number(bare.trim())
    if (Number.isFinite(score)) {
      return { ...classify(score, 5), symbols: [], source: 'spamassassin' }
    }
  }

  const flag = header(headers, 'x-spam-flag') ?? header(headers, 'x-spam')
  if (flag && /^(yes|true)\b/i.test(flag.trim())) {
    return { verdict: 'spam', score: 1, threshold: 1, ratio: 1, symbols: [], source: 'flag' }
  }

  return null
}
