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
 * What a link of a message is allowed to do. Only web addresses and telephone numbers are opened: any other
 * kind is how a page reaches into the phone, such as a file of the application, a provider of its own, or an
 * intent for another application. A mail address is not opened either, the application writes to those itself.
 */
export function decideLink(url: string, pageLinks: PageLink[], knownDomains: string[]): LinkDecision {
  const kind = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1].toLowerCase()
  if (kind === 'tel') return { action: 'open', url }
  if (kind !== 'http' && kind !== 'https') return { action: 'ignore' }

  // What the link said on the page is what it is measured against, so the first one with this address says it.
  const text = pageLinks.find((link) => link.href === url)?.text
  const analysis = analyzeLink(url, text || undefined, knownDomains)
  return analysis.findings.length > 0 ? { action: 'confirm', analysis } : { action: 'open', url }
}
