/**
 * Unsubscribing from a mailing list the way the message itself offers it: the `List-Unsubscribe` header (RFC 2369) and, with it, `List-Unsubscribe-Post`
 * (RFC 8058, "one click"). What a message says is not to be trusted: it is written by whoever sent it, and a message that pretends to be a newsletter can
 * point anywhere. So this reads only what is safe to act on and says what is not.
 *
 * - A `mailto:` entry is a message to the address the user can read and send, never sent by itself.
 * - An `https:` entry is POSTed to only when the sender says it takes that (`List-Unsubscribe=One-Click`), and only to a host on the public internet: no
 *   address of a network, no `localhost`, no name without a dot, no login in the address, no other port. Anything over plain `http:` is ignored.
 * - An `https:` entry without that is a page, opened in the browser after the user has seen where it leads.
 * - A message that looks wrong (the server called it spam, an authentication check failed, the sender looks like somebody else) is not offered at all:
 *   answering it confirms to a stranger that the address is read.
 */

/** A message to ask the list to take the address off, as the header gives it. */
export interface UnsubscribeMail {
  to: string
  subject: string
  body: string
}

/** An address on the internet, and the name of the host as it is shown to the user. */
export interface UnsubscribeUrl {
  url: string
  host: string
}

export interface UnsubscribeOptions {
  mail: UnsubscribeMail | null
  /** To be POSTed to: the sender said it takes one click. */
  oneClick: UnsubscribeUrl | null
  /** To be opened in the browser. */
  page: UnsubscribeUrl | null
}

const MAX_URL = 2000
const ADDRESS = /^[^\s@<>,;()"[\]\\]+@[^\s@<>,;()"[\]\\]+\.[^\s@<>,;()"[\]\\]+$/

/** What a host may be: letters, digits, dots and hyphens, with at least one dot, and not a name of this machine or of a private network. */
function usableHost(host: string): boolean {
  const name = host.toLowerCase()
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(name)) return false
  // An address of a network written with numbers: nothing public is named that way.
  if (/^[0-9.]+$/.test(name)) return false
  return !/(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain)$/.test(name)
}

/** An `https:` address that is safe to go to, or null: no login in it, the usual port, a public host, not absurdly long. */
export function safeHttpsUrl(entry: string): UnsubscribeUrl | null {
  if (entry.length > MAX_URL) return null
  const match = /^https:\/\/([^/?#:@\s]+)(\/[^\s#]*)?(#.*)?$/i.exec(entry)
  if (!match) return null
  const host = match[1].toLowerCase()
  if (!usableHost(host)) return null
  return { url: entry.replace(/#.*$/, ''), host }
}

function decoded(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    return value
  }
}

/** A `mailto:` entry for one address, with the subject and body it asks for, cut short and on one line where it is a header. */
export function safeMailto(entry: string): UnsubscribeMail | null {
  const match = /^mailto:([^?]*)(?:\?(.*))?$/is.exec(entry)
  if (!match) return null
  const to = decoded(match[1]).trim()
  if (!ADDRESS.test(to)) return null
  let subject = ''
  let body = ''
  for (const pair of (match[2] ?? '').split('&')) {
    const at = pair.indexOf('=')
    if (at < 0) continue
    const name = pair.slice(0, at).toLowerCase()
    if (name === 'subject') subject = decoded(pair.slice(at + 1)).replace(/\s+/g, ' ').trim().slice(0, 200)
    else if (name === 'body') body = decoded(pair.slice(at + 1)).replace(/\r\n?/g, '\n').slice(0, 1000)
  }
  return { to, subject, body }
}

/** What a message's `List-Unsubscribe` and `List-Unsubscribe-Post` headers offer, or null when there is nothing that is safe to use. */
export function parseUnsubscribe(listUnsubscribe: string | undefined, listUnsubscribePost: string | undefined): UnsubscribeOptions | null {
  if (!listUnsubscribe) return null
  const entries = [...listUnsubscribe.matchAll(/<([^<>]*)>/g)].map((found) => found[1].replace(/\s+/g, ''))
  const oneClickAllowed = /(^|[\s;,])List-Unsubscribe\s*=\s*One-Click(\s|$|;|,)/i.test(listUnsubscribePost ?? '')

  let mail: UnsubscribeMail | null = null
  let https: UnsubscribeUrl | null = null
  for (const entry of entries) {
    if (!mail && /^mailto:/i.test(entry)) mail = safeMailto(entry)
    else if (!https && /^https:/i.test(entry)) https = safeHttpsUrl(entry)
  }
  const options: UnsubscribeOptions = { mail, oneClick: https && oneClickAllowed ? https : null, page: https && !oneClickAllowed ? https : null }
  return options.mail || options.oneClick || options.page ? options : null
}

/** How it is done, in the order that is best: one click needs nothing from the user, a message is sent by them, a page is opened by them. */
export type UnsubscribeMode = 'one-click' | 'mail' | 'page'

/** Something about the message that the user should know before they go on. */
export type UnsubscribeCaution =
  /** Nothing else on the phone is from the sender: answering tells a stranger that this address is read. */
  | 'first-contact'
  /** The address to go to belongs to another site than the sender: usual for a service that sends for others, and worth seeing. */
  | 'other-site'

export interface UnsubscribeAdvice {
  /** The way to do it, or null when there is none to offer. */
  mode: UnsubscribeMode | null
  /** The message looks wrong: nothing is offered, and marking it as spam is what is left. */
  blocked: boolean
  cautions: UnsubscribeCaution[]
  /** Where it goes to: the host for a page or a click, the address for a message. */
  target: string
}

/** What is known of the message from outside the headers that offer this. */
export interface UnsubscribeContext {
  /** The server called it spam, or an authentication check failed, or the sender looks like somebody else. */
  suspicious: boolean
  firstContact: boolean
  /** The domain of the address the message is from. */
  senderDomain: string
}

const sameSite = (a: string, b: string): boolean => a === b || a.endsWith('.' + b) || b.endsWith('.' + a)

export function adviseUnsubscribe(options: UnsubscribeOptions, context: UnsubscribeContext): UnsubscribeAdvice {
  const mode: UnsubscribeMode | null = options.oneClick ? 'one-click' : options.mail ? 'mail' : options.page ? 'page' : null
  const target = mode === 'mail' ? (options.mail?.to ?? '') : ((mode === 'one-click' ? options.oneClick : options.page)?.host ?? '')
  const targetSite = mode === 'mail' ? target.slice(target.lastIndexOf('@') + 1).toLowerCase() : target
  const sender = context.senderDomain.toLowerCase()
  const cautions: UnsubscribeCaution[] = []
  if (context.firstContact) cautions.push('first-contact')
  if (mode && sender && targetSite && !sameSite(targetSite, sender)) cautions.push('other-site')
  return { mode: context.suspicious ? null : mode, blocked: context.suspicious && mode !== null, cautions, target }
}
