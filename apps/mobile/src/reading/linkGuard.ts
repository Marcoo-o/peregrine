import { analyzeLink, type LinkAnalysis } from '@peregrine/core/linkSafety'
import type { PageLink } from './assessment'

export type LinkDecision =
  /** Nothing is wrong with it: it is opened at once. A check that interrupts every time is clicked away unread. */
  | { action: 'open'; url: string }
  /** It does not lead where it reads: the user is shown where it leads first. */
  | { action: 'confirm'; analysis: LinkAnalysis }
  /** It is not something to open from a message. */
  | { action: 'ignore' }

/**
 * An address in the one spelling that the spellings of it have that only differ in what a browser changes: the
 * case of the kind of address and of the host, a path that is left out, a space, a fragment. Written out and
 * not left to `URL`, which is the platform's, and not the same on every one: if two spellings were not
 * recognised as one here, a tap on a link would not be taken for one.
 */
export function normalised(address: string): string {
  const match = /^([a-z][a-z0-9+.-]*):(\/\/)?([^/?#]*)([^?#]*)(\?[^#]*)?/i.exec(address.trim())
  if (!match) return address
  const [, scheme, slashes, authority, path, query = ''] = match
  const start = scheme.toLowerCase() + ':'
  const spelled = slashes ? `${start}//${authority.toLowerCase()}${path || '/'}${query}` : `${start}${authority}${path}${query}`
  return spelled.replace(/ /g, '%20')
}

/**
 * What a navigation of the page is allowed to do. The view reports every navigation alike, a link that was
 * followed, a form that was sent, a redirect, a window the page opens, and only the first is something the user
 * did. So it is only a tap on a link when it leads to the address of a link the page has. Of those, only web
 * addresses and telephone numbers are opened: any other kind is how a page reaches into the phone, such as a
 * file of the application, a provider of its own, or an intent for another application. A mail address is not
 * opened either, the application writes to those itself.
 */
export function decideLink(url: string, pageLinks: PageLink[], knownDomains: string[]): LinkDecision {
  const kind = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1].toLowerCase()
  if (kind !== 'tel' && kind !== 'http' && kind !== 'https') return { action: 'ignore' }

  // What the link said on the page is what it is measured against, so the first one with this address says it.
  const wanted = normalised(url)
  const tapped = pageLinks.find((link) => normalised(link.href) === wanted)
  if (!tapped) return { action: 'ignore' }
  if (kind === 'tel') return { action: 'open', url }

  const analysis = analyzeLink(url, tapped.text || undefined, knownDomains)
  return analysis.findings.length > 0 ? { action: 'confirm', analysis } : { action: 'open', url }
}
