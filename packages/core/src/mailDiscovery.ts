import { parseAutoconfig, type DiscoveredConfig } from './autoconfig'
import type { DiscoveryResult, DiscoverySource } from './types'

/**
 * Finds the server settings for an address, over the web.
 *
 * Three sources of that kind, in the order in which they deserve to be trusted:
 *
 *  1. `autoconfig.<domain>`. Published by the provider, about its own service.
 *  2. `<domain>/.well-known/autoconfig`. The same, on the main host.
 *  3. Mozilla's database. A third party, but a curated one, and it only ever learns the domain. The address itself never leaves
 *     the machine for this step.
 *
 * A fourth, DNS SRV (RFC 6186), is not a request over the web and is for the platform to add: it is given as `srv`.
 *
 * Everything is fetched over HTTPS only. Thunderbird still allows plain HTTP for the first two, and it is exactly the case where it must
 * not be allowed: an attacker on the network could answer with a server of their own choosing, and the next thing the user does is type
 * their password into it.
 *
 * How a document is fetched (with the timeouts that suit the platform, and the limit on its size) is the platform's: `fetchText` gives the
 * text or null for anything that is not a document.
 */
export type FetchText = (url: string) => Promise<string | null>

interface Attempt {
  source: DiscoverySource
  url: (domain: string, email: string) => string
}

const ATTEMPTS: Attempt[] = [
  { source: 'provider', url: (domain, email) => `https://autoconfig.${domain}/mail/config-v1.1.xml?emailaddress=${encodeURIComponent(email)}` },
  {
    source: 'wellKnown',
    url: (domain, email) => `https://${domain}/.well-known/autoconfig/mail/config-v1.1.xml?emailaddress=${encodeURIComponent(email)}`
  },
  {
    // Only the domain goes into this URL. Deliberately, and the reason this step is acceptable at all.
    source: 'mozilla',
    url: (domain) => `https://autoconfig.thunderbird.net/v1.1/${encodeURIComponent(domain)}`
  }
]

/** Runs a set of sources side by side and picks by trust, not by who answered first. */
async function firstOf(attempts: Attempt[], domain: string, email: string, fetchText: FetchText): Promise<DiscoveryResult | null> {
  const documents = await Promise.all(attempts.map((attempt) => fetchText(attempt.url(domain, email))))
  for (const [index, xml] of documents.entries()) {
    if (!xml) continue
    const config = parseAutoconfig(xml, email)
    if (config) return { found: true, source: attempts[index].source, config }
  }
  return null
}

/**
 * Two rounds, and the split between them is the point.
 *
 * Within a round the sources run side by side, because asking them one after the other adds up their timeouts. The result is still chosen
 * in order of trust, not by whoever replied first.
 *
 * The rounds themselves stay sequential for one reason: the first asks only the user's own provider, the second asks outsiders. Merging
 * them would send the domain to a Mozilla server even in the common case where the provider answers for itself, and that request would
 * then be made for nothing.
 */
export async function discoverMailConfig(
  email: string,
  fetchText: FetchText,
  srv?: (domain: string, email: string) => Promise<DiscoveredConfig | null>
): Promise<DiscoveryResult> {
  const address = email.trim()
  const domain = address.split('@')[1]?.trim().toLowerCase()
  if (!domain || !address.includes('@')) return { found: false }

  const fromOwnDomain = await firstOf(
    ATTEMPTS.filter((attempt) => attempt.source !== 'mozilla'),
    domain,
    address,
    fetchText
  )
  if (fromOwnDomain) return fromOwnDomain

  const [external, fromSrv] = await Promise.all([
    firstOf(
      ATTEMPTS.filter((attempt) => attempt.source === 'mozilla'),
      domain,
      address,
      fetchText
    ),
    srv ? srv(domain, address) : Promise.resolve(null)
  ])
  if (external) return external
  if (fromSrv) return { found: true, source: 'srv', config: fromSrv }
  return { found: false }
}
