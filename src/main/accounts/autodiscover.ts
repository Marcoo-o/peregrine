import { resolveSrv } from 'node:dns/promises'
import type { DiscoveredConfig } from '@peregrine/core/autoconfig'
import { discoverMailConfig as discoverFromWeb } from '@peregrine/core/mailDiscovery'
import type { DiscoveryResult } from '@peregrine/core/types'
import { withTimeout } from '../util/withTimeout'

/**
 * Finds the server settings for an address.
 *
 * Four sources, in the order in which they deserve to be trusted:
 *
 *  1. `autoconfig.<domain>`. Published by the provider, about its own service.
 *  2. `<domain>/.well-known/autoconfig`. The same, on the main host.
 *  3. Mozilla's database. A third party, but a curated one, and it only ever learns the
 *     domain. The address itself never leaves the machine for this step.
 *  4. DNS SRV records. Standardised (RFC 6186), served by whoever runs the domain, but they
 *     carry no username rules, so the address is used as the username.
 *
 * Everything is fetched over HTTPS only. Thunderbird still allows plain HTTP for the first
 * two, and it is exactly the case where it must not be allowed: an attacker on the network
 * could answer with a server of their own choosing, and the next thing the user does is type
 * their password into it.
 */

/** Long enough for a slow server, short enough that setting up an account stays bearable. */
const TIMEOUT_MS = 5000
/** An autoconfig document is a few kilobytes; anything larger is not one. */
const MAX_BYTES = 256 * 1024

/**
 * Fetches a document, or gives up.
 *
 * Two timeouts, and both are needed. The AbortController stops the request once a connection
 * exists. It does not help while the name is still being looked up: a DNS query has no
 * cancel, so a host that resolves slowly, or a firewall that silently drops the packets,
 * holds the promise regardless of the signal. Measured against a domain that does not answer:
 * without the outer race a single lookup ran for close to two minutes.
 */
async function fetchText(url: string): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const request = async (): Promise<string | null> => {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { Accept: 'application/xml, text/xml' }
    })
    if (!response.ok) return null
    const length = Number(response.headers.get('content-length') ?? 0)
    if (length > MAX_BYTES) return null
    const text = await response.text()
    return text.length > MAX_BYTES ? null : text
  }

  try {
    return await withTimeout(request(), TIMEOUT_MS, url)
  } catch {
    // Any failure is simply "this source has nothing".
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * RFC 6186: `_imaps._tcp` and `_submission._tcp` name host and port directly.
 *
 * A record with the target "." means the service is explicitly not offered, which is a
 * different answer from "no record" and must not be read as a hostname.
 */
async function fromSrv(domain: string, email: string): Promise<DiscoveredConfig | null> {
  const lookup = async (service: string): Promise<{ host: string; port: number } | null> => {
    try {
      // Same reason as the fetch: a resolver that does not answer must not hold the setup.
      const records = await withTimeout(resolveSrv(`${service}.${domain}`), TIMEOUT_MS, service)
      const usable = records
        .filter((record) => record.name && record.name !== '.')
        .sort((a, b) => a.priority - b.priority || b.weight - a.weight)[0]
      return usable ? { host: usable.name, port: usable.port } : null
    } catch {
      return null
    }
  }

  const [imaps, submissions, submission] = await Promise.all([
    lookup('_imaps._tcp'),
    lookup('_submissions._tcp'),
    lookup('_submission._tcp')
  ])
  if (!imaps) return null

  // `_submissions` is the implicit-TLS one, `_submission` the STARTTLS one; the record that
  // exists decides the mode, rather than guessing from the port number.
  const outgoing = submissions ?? submission
  if (!outgoing) return null

  return {
    displayName: domain,
    imap: { ...imaps, secure: 'tls', username: email, authType: 'password' },
    smtp: {
      ...outgoing,
      secure: submissions ? 'tls' : 'starttls',
      username: email,
      authType: 'password'
    }
  }
}

/** Finds the server settings for an address: the rounds over the web are the shared ones, and DNS SRV is this platform's. */
export function discoverMailConfig(email: string): Promise<DiscoveryResult> {
  return discoverFromWeb(email, fetchText, fromSrv)
}
