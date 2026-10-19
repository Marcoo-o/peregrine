/**
 * Spots links and addresses that are built to be misread.
 *
 * The attacks this covers all work the same way: the address a person reads and the address
 * the browser resolves are not the same string. A domain can say "apple.com" using a Cyrillic
 * а, hide a character that renders as nothing, or put the real host after an @ where nobody
 * looks. None of that is detectable by eye, which is the whole point of it.
 *
 * Everything here is a judgement about text, never about reputation: no list of known-bad
 * domains, no network lookup. A finding says "this is not what it appears to be", which is
 * checkable and stays true, rather than "this is dangerous", which would be a guess.
 */

export type LinkRisk =
  /** The domain is encoded form; what it renders as may differ from what it reads as. */
  | 'punycode'
  /** One label mixes alphabets that look alike. The classic lookalike domain. */
  | 'mixedScript'
  /** Characters that render as nothing or reverse the reading direction. */
  | 'invisibleCharacters'
  /** The visible text names a different destination than the link leads to. */
  | 'textMismatch'
  /** Everything before the @ is ignored by the browser; the real host comes after it. */
  | 'userInfo'
  /** A bare address instead of a name. No domain, nothing to recognise. */
  | 'ipAddressHost'
  /** Resembles a domain the user actually corresponds with. */
  | 'lookalikeDomain'

export interface LinkFinding {
  risk: LinkRisk
  /** The concrete thing that was found, for showing next to the warning. */
  detail: string
}

export interface LinkAnalysis {
  href: string
  /** The host as a person would read it. Punycode resolved back to its characters. */
  displayHost: string
  findings: LinkFinding[]
}

// ---------------------------------------------------------------------------
// Punycode
// ---------------------------------------------------------------------------

const PUNYCODE_PREFIX = 'xn--'
const BASE = 36
const TMIN = 1
const TMAX = 26
const SKEW = 38
const DAMP = 700
const INITIAL_BIAS = 72
const INITIAL_N = 128

function digitValue(codePoint: number): number {
  if (codePoint >= 0x30 && codePoint <= 0x39) return codePoint - 0x30 + 26 // 0-9
  if (codePoint >= 0x41 && codePoint <= 0x5a) return codePoint - 0x41 // A-Z
  if (codePoint >= 0x61 && codePoint <= 0x7a) return codePoint - 0x61 // a-z
  return BASE
}

function adaptBias(delta: number, numPoints: number, firstTime: boolean): number {
  let d = firstTime ? Math.floor(delta / DAMP) : delta >> 1
  d += Math.floor(d / numPoints)
  let k = 0
  while (d > ((BASE - TMIN) * TMAX) >> 1) {
    d = Math.floor(d / (BASE - TMIN))
    k += BASE
  }
  return k + Math.floor(((BASE - TMIN + 1) * d) / (d + SKEW))
}

/**
 * Decodes one `xn--` label back to the characters it stands for (RFC 3492).
 *
 * Written out rather than taken from a library because the platform offers no way to do it:
 * `URL` normalises hosts *to* Punycode and never back, so without this the check could only
 * ever report "encoded" and never what it actually says.
 *
 * Returns null if the label is not valid Punycode. A malformed label is left as it is
 * rather than guessed at.
 */
export function decodePunycode(label: string): string | null {
  if (!label.toLowerCase().startsWith(PUNYCODE_PREFIX)) return null
  const encoded = label.slice(PUNYCODE_PREFIX.length)
  if (encoded === '') return null

  const lastDelimiter = encoded.lastIndexOf('-')
  const output: number[] = []
  for (const char of lastDelimiter > 0 ? encoded.slice(0, lastDelimiter) : '') {
    const code = char.codePointAt(0) as number
    if (code > 0x7f) return null
    output.push(code)
  }

  let index = lastDelimiter > 0 ? lastDelimiter + 1 : 0
  let n = INITIAL_N
  let i = 0
  let bias = INITIAL_BIAS

  while (index < encoded.length) {
    const oldI = i
    let weight = 1
    for (let k = BASE; ; k += BASE) {
      if (index >= encoded.length) return null
      const digit = digitValue(encoded.charCodeAt(index++))
      if (digit >= BASE) return null
      if (digit > Math.floor((0x7fffffff - i) / weight)) return null
      i += digit * weight
      const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias
      if (digit < t) break
      weight *= BASE - t
    }
    bias = adaptBias(i - oldI, output.length + 1, oldI === 0)
    n += Math.floor(i / (output.length + 1))
    if (n > 0x10ffff) return null
    i %= output.length + 1
    output.splice(i, 0, n)
    i++
  }

  return String.fromCodePoint(...output)
}

/** Resolves every encoded label of a host, leaving the rest untouched. */
export function decodeHost(host: string): string {
  return host
    .split('.')
    .map((label) => decodePunycode(label) ?? label)
    .join('.')
}

// ---------------------------------------------------------------------------
// Scripts
// ---------------------------------------------------------------------------

type Script = 'latin' | 'cyrillic' | 'greek' | 'armenian' | 'other'

/**
 * Only the alphabets that actually get confused with each other are told apart.
 *
 * Cyrillic, Greek and Armenian carry letters drawn identically to Latin ones. А, е, о, ο, հ.
 * CJK, Hebrew or Arabic look nothing like Latin, so a domain mixing those with Latin is
 * ordinary (a Japanese company name plus "shop"), not an attack, and must not be flagged.
 */
function scriptOf(char: string): Script {
  const code = char.codePointAt(0) as number
  if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) return 'latin'
  if (code >= 0x00c0 && code <= 0x024f) return 'latin' // accented Latin
  if (code >= 0x0370 && code <= 0x03ff) return 'greek'
  if (code >= 0x0400 && code <= 0x04ff) return 'cyrillic'
  if (code >= 0x0530 && code <= 0x058f) return 'armenian'
  return 'other'
}

const CONFUSABLE_SCRIPTS: Script[] = ['latin', 'cyrillic', 'greek', 'armenian']

/**
 * Alphabets that are mixed inside a single label.
 *
 * Per label, not per domain: "москва.shop" is a normal Cyrillic domain with a Latin suffix,
 * while "аpple.com" hides one Cyrillic letter among Latin ones. Only the second is a forgery,
 * and only looking at each label on its own tells them apart.
 */
export function mixedScriptsIn(host: string): Script[] {
  for (const label of host.split('.')) {
    const scripts = new Set<Script>()
    for (const char of label) {
      const script = scriptOf(char)
      if (CONFUSABLE_SCRIPTS.includes(script)) scripts.add(script)
    }
    if (scripts.size > 1) return [...scripts]
  }
  return []
}

// ---------------------------------------------------------------------------
// Invisible characters
// ---------------------------------------------------------------------------

/**
 * Characters that take up no space or change the reading direction.
 *
 * A zero-width space inside a domain is invisible but makes the string a different one; a
 * right-to-left override can display "exe.pdf" for a file actually called "fdp.exe".
 */
const INVISIBLE = /[­​-‏‪-‮⁠-⁤﻿]/gu

export function invisibleCharactersIn(value: string): string[] {
  const found = value.match(INVISIBLE)
  if (!found) return []
  return [...new Set(found)].map(
    (char) => `U+${(char.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, '0')}`
  )
}

// ---------------------------------------------------------------------------
// Lookalikes of domains the user actually deals with
// ---------------------------------------------------------------------------

/**
 * Edit distance, capped.
 *
 * Stops as soon as the distance exceeds `limit`, because the answer beyond that is only ever
 * "not similar" and this runs against every known domain for every link.
 */
export function editDistance(a: string, b: string, limit = 2): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
      rowMin = Math.min(rowMin, current[j])
    }
    if (rowMin > limit) return limit + 1
    previous = current
  }
  return previous[b.length]
}

/** The label in front of the public suffix. "hausbank" out of "hausbank.test". */
function nameLabel(domain: string): string {
  const parts = domain.split('.')
  // Two-part suffixes (co.uk, com.au) would otherwise yield the wrong label.
  if (parts.length >= 3 && parts[parts.length - 2].length <= 3) return parts[parts.length - 3]
  return parts[parts.length - 2] ?? ''
}

/**
 * Second level labels that name a category under a country code, as in co.uk and com.au. In front
 * of such a suffix the registrable domain is one label longer.
 */
const CATEGORY_LABELS = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'or', 'ne', 'go', 'gob', 'nom', 'ltd', 'plc', 'sch'])

/**
 * The part of a domain somebody registered, which is the part they alone control: `example.org`
 * out of `mail.example.org`, and `example.co.uk` out of `shop.example.co.uk`.
 *
 * Without the public suffix list this is a close approximation, and wrong for hosts where every
 * customer gets a subdomain of one shared name (`github.io`, `blogspot.com`). There, two
 * subdomains count as one organisation when they are not.
 */
function registrableDomain(domain: string): string {
  const parts = domain.split('.')
  if (parts.length <= 2) return domain
  const top = parts[parts.length - 1]
  const second = parts[parts.length - 2]
  return parts.slice(top.length === 2 && CATEGORY_LABELS.has(second) ? -3 : -2).join('.')
}

/**
 * Short names collide by accident. "post.de" and "host.de" are one edit apart and unrelated,
 * so below this length only the substring rule applies, never the edit distance.
 */
const MIN_NAME_LENGTH = 5

/**
 * Finds the known domain a host is imitating, if any.
 *
 * Two shapes, because attackers use both and they need different tests:
 *  - one or two characters changed: `hausbamk.test`, `paypa1.com`
 *  - the real name moved somewhere it does not govern: `hausbank-test.com`,
 *    `login-hausbank.net`, `hausbank.test.abrechnung.net`
 *
 * `knownDomains` should hold only domains the user actually corresponds with. Checking against
 * a list of famous brands instead would warn about mail from companies they have never dealt
 * with, and stay silent about the small supplier whose invoices they actually pay.
 */
export function lookalikeOf(host: string, knownDomains: Iterable<string>): string | null {
  const candidate = baseHost(host)
  if (!candidate) return null
  const candidateName = nameLabel(candidate)

  for (const raw of knownDomains) {
    const known = baseHost(raw)
    if (!known || known === candidate) continue
    // Whatever sits under the same registered domain belongs to the same organisation, in either
    // direction. `example.org` and `mail.example.org` are one owner's, and so are `news.` and
    // `mail.` under it, because nobody else can create a name below a domain that is not theirs.
    // Warning about a person's own domain, which is the one they correspond with most, was the
    // commonest false alarm.
    if (registrableDomain(candidate) === registrableDomain(known)) continue

    if (
      candidateName.length >= MIN_NAME_LENGTH &&
      known.length >= MIN_NAME_LENGTH &&
      editDistance(candidate, known) <= 2
    ) {
      return known
    }

    const knownName = nameLabel(known)
    if (knownName.length >= MIN_NAME_LENGTH && candidate.includes(knownName)) {
      return known
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Link analysis
// ---------------------------------------------------------------------------

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/

/** Strips a leading "www." so that comparing what is written to where it goes is fair. */
function baseHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '')
}

/**
 * Whether the link text claims to be an address itself.
 *
 * Only then is a mismatch worth reporting: "click here" pointing at example.com is normal
 * writing, while "paypal.com" pointing at evil.ru is the mismatch that matters.
 */
function hostClaimedByText(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed.includes(' ')) return null
  const match = /^(?:https?:\/\/)?([a-z0-9¡-￿.-]+\.[a-z¡-￿]{2,})(?:[/?#].*)?$/i.exec(
    trimmed
  )
  return match ? baseHost(match[1]) : null
}

/**
 * Examines one link.
 *
 * `linkText` is what the reader sees; passing it in enables the mismatch check, which is the
 * single most common shape of a phishing link.
 */
export function analyzeLink(
  href: string,
  linkText?: string,
  knownDomains: Iterable<string> = []
): LinkAnalysis {
  const findings: LinkFinding[] = []

  let url: URL
  try {
    url = new URL(href)
  } catch {
    return { href, displayHost: '', findings }
  }

  const decodedHost = decodeHost(url.hostname)

  if (url.hostname.split('.').some((label) => label.toLowerCase().startsWith(PUNYCODE_PREFIX))) {
    findings.push({ risk: 'punycode', detail: decodedHost })
  }

  const mixed = mixedScriptsIn(decodedHost)
  if (mixed.length > 0) {
    findings.push({ risk: 'mixedScript', detail: mixed.join(' + ') })
  }

  const invisible = invisibleCharactersIn(href)
  if (invisible.length > 0) {
    findings.push({ risk: 'invisibleCharacters', detail: invisible.join(', ') })
  }

  // Anything before the @ is credentials, not the destination. A browser ignores it, a
  // reader does not, which is exactly what makes it useful for hiding the real host.
  if (url.username !== '' || url.password !== '') {
    findings.push({ risk: 'userInfo', detail: decodedHost })
  }

  if (IPV4.test(url.hostname)) {
    findings.push({ risk: 'ipAddressHost', detail: url.hostname })
  }

  const lookalike = lookalikeOf(decodedHost, knownDomains)
  if (lookalike) {
    findings.push({ risk: 'lookalikeDomain', detail: lookalike })
  }

  if (linkText) {
    const claimed = hostClaimedByText(linkText)
    const actual = baseHost(decodedHost)
    if (claimed && claimed !== actual && !actual.endsWith(`.${claimed}`)) {
      findings.push({ risk: 'textMismatch', detail: `${claimed} → ${actual}` })
    }
  }

  return { href, displayHost: decodedHost, findings }
}

// ---------------------------------------------------------------------------
// Sender analysis
// ---------------------------------------------------------------------------

export type SenderRisk =
  /** The display name contains an address other than the one that actually sent the mail. */
  | 'nameContainsOtherAddress'
  /** A reply would go somewhere else than the mail came from. */
  | 'replyToMismatch'
  | 'invisibleCharacters'
  | 'mixedScript'
  | 'punycode'
  /** Resembles a domain the user actually corresponds with. */
  | 'lookalikeDomain'

export interface SenderFinding {
  risk: SenderRisk
  detail: string
}

const ADDRESS_IN_TEXT = /[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/

function domainOf(address: string): string {
  const at = address.lastIndexOf('@')
  return at === -1 ? '' : address.slice(at + 1).toLowerCase()
}

/**
 * Checks who a message says it is from.
 *
 * The display name is free text the sender chooses. Writing "service@bank.example" in it
 * while sending from somewhere else costs nothing and is a standard trick, because most
 * clients show the name and hide the address.
 */
export function analyzeSender(
  fromName: string,
  fromAddress: string,
  replyToAddress?: string | null,
  knownDomains: Iterable<string> = []
): SenderFinding[] {
  const findings: SenderFinding[] = []
  const actualDomain = domainOf(fromAddress)

  const claimed = ADDRESS_IN_TEXT.exec(fromName)
  if (claimed && claimed[1].toLowerCase() !== actualDomain) {
    findings.push({ risk: 'nameContainsOtherAddress', detail: `${claimed[0]} → ${fromAddress}` })
  }

  if (replyToAddress) {
    const replyDomain = domainOf(replyToAddress)
    if (replyDomain !== '' && replyDomain !== actualDomain) {
      findings.push({ risk: 'replyToMismatch', detail: replyToAddress })
    }
  }

  const invisible = invisibleCharactersIn(`${fromName} ${fromAddress}`)
  if (invisible.length > 0) {
    findings.push({ risk: 'invisibleCharacters', detail: invisible.join(', ') })
  }

  const decodedDomain = decodeHost(actualDomain)
  if (actualDomain.split('.').some((l) => l.startsWith(PUNYCODE_PREFIX))) {
    findings.push({ risk: 'punycode', detail: decodedDomain })
  }
  const mixed = mixedScriptsIn(decodedDomain)
  if (mixed.length > 0) {
    findings.push({ risk: 'mixedScript', detail: mixed.join(' + ') })
  }

  const lookalike = lookalikeOf(decodedDomain, knownDomains)
  if (lookalike) {
    findings.push({ risk: 'lookalikeDomain', detail: lookalike })
  }

  return findings
}
