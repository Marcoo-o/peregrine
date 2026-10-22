import { failedChecks, parseAuthenticationResults, type AuthResults } from '@peregrine/core/authResults'
import { analyzeLink, analyzeSender, type LinkAnalysis, type SenderFinding } from '@peregrine/core/linkSafety'
import { assessSpam, type SpamAssessment } from '@peregrine/core/spamScore'
import { parseAddress } from '@peregrine/smtp/headers'
import type { ReadableMessage } from '../messageText'

/**
 * What can be said of a message from its headers, at once: the verdict of the server that delivered it,
 * the checks of its sender that failed, and what is wrong with who it says it is from. The rules are
 * those of the desktop, in `@peregrine/core`, and nothing here reaches out to ask anyone about the sender.
 */
export interface MessageAssessment {
  /** The server's verdict when it found the message borderline or spam. A clean one is not worth saying. */
  spam: SpamAssessment | null
  failedAuth: Array<keyof AuthResults>
  sender: SenderFinding[]
  /** Nothing else of what the phone has is from the sender. Worth knowing, not a warning. */
  firstContact: boolean
}

export function assessMessage(message: ReadableMessage, knownDomains: string[], firstContact: boolean): MessageAssessment {
  const spam = assessSpam(message.headers)
  const from = parseAddress(message.from)
  const replyTo = message.replyTo ? parseAddress(message.replyTo).address : null
  return {
    spam: spam && spam.verdict !== 'clean' ? spam : null,
    failedAuth: failedChecks(parseAuthenticationResults(message.headers['authentication-results'])),
    sender: analyzeSender(from.name ?? '', from.address, replyTo, knownDomains),
    firstContact
  }
}

/** The domains the user has addresses in, once each and in lower case: what a lookalike is measured against. */
export function knownDomainsOf(accounts: { emailAddress: string }[]): string[] {
  const domains = accounts.flatMap(({ emailAddress }) => {
    const at = emailAddress.lastIndexOf('@')
    return at === -1 ? [] : [emailAddress.slice(at + 1).toLowerCase()]
  })
  return [...new Set(domains.filter((domain) => domain !== ''))]
}

/** A link of the page: where it leads and what it says, which is what is compared. */
export interface PageLink {
  href: string
  text: string
}

/** An image of the page, as the page declares it. Nothing has been loaded to find out more. */
export interface PageImage {
  src: string
  width: string | null
  height: string | null
  style: string
}

/** What the page of a message has in it that is worth a look, as the page reports it. */
export interface PageFacts {
  links: PageLink[]
  images: PageImage[]
}

export interface PageAssessment {
  /** The links that do not lead where they read, one for each destination: a newsletter repeats one forty times. */
  links: LinkAnalysis[]
  /** How many images exist only to report that the message was opened. */
  trackingPixels: number
}

const TINY_STYLE = /(?:width|height)\s*:\s*[012](?:px)?\b/i

function isTrackingPixel(image: PageImage): boolean {
  if (!/^https?:/i.test(image.src)) return false
  const tinyAttributes = image.width !== null && image.height !== null && +image.width <= 2 && +image.height <= 2
  return tinyAttributes || TINY_STYLE.test(image.style)
}

export function assessPage(facts: PageFacts, knownDomains: string[]): PageAssessment {
  const seen = new Set<string>()
  const links: LinkAnalysis[] = []
  for (const link of facts.links) {
    if (!/^https?:/i.test(link.href) || seen.has(link.href)) continue
    seen.add(link.href)
    const analysis = analyzeLink(link.href, link.text || undefined, knownDomains)
    if (analysis.findings.length > 0) links.push(analysis)
  }
  return { links, trackingPixels: facts.images.filter(isTrackingPixel).length }
}

/** The web addresses in a text, for a message that has no page. The punctuation that ends a sentence is not part of one. */
export function linksInText(text: string): PageLink[] {
  return [...text.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)].map((match) => ({
    href: match[0].replace(/[.,;:!?]+$/, ''),
    text: ''
  }))
}
