import { appError } from '@peregrine/core/errorText'
import { keyserverUrl, KEYSERVER_BASE, wkdUrls } from '@peregrine/core/keyLookup'
import { createHash } from 'node:crypto'
import { normalizeDiscoveredKey } from './pgpService'

const REQUEST_TIMEOUT_MS = 10_000

const sha1 = (bytes: Uint8Array): Uint8Array => new Uint8Array(createHash('sha1').update(bytes).digest())
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export interface DiscoveredKey {
  publicKeyArmored: string
  fingerprint: string
  source: 'WKD' | 'keys.openpgp.org'
}

/**
 * Fetches a candidate URL and only reports success if the payload actually parses as an
 * OpenPGP key. A bare HTTP 200 is not sufficient evidence: hosts with catch-all routing or
 * SPA fallbacks happily return an HTML page for the .well-known path, and treating that as a
 * key would abort the lookup instead of falling through to the next source.
 */
async function tryFetchKey(
  url: string,
  source: DiscoveredKey['source']
): Promise<DiscoveredKey | null> {
  try {
    const response = await fetchWithTimeout(url)
    if (!response.ok) return null
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length === 0) return null

    const { publicKeyArmored, fingerprint } = await normalizeDiscoveredKey(buffer)
    return { publicKeyArmored, fingerprint, source }
  } catch {
    return null
  }
}

/** Web Key Directory lookup, trying the advanced (openpgpkey subdomain) method first. */
export async function lookupViaWkd(email: string): Promise<DiscoveredKey | null> {
  for (const url of wkdUrls(email, sha1, utf8)) {
    const key = await tryFetchKey(url, 'WKD')
    if (key) return key
  }
  return null
}

/** keys.openpgp.org VKS lookup; only returns addresses whose owner opted in to publication. */
export async function lookupViaKeyserver(email: string): Promise<DiscoveredKey | null> {
  return tryFetchKey(keyserverUrl(email), 'keys.openpgp.org')
}

export async function discoverPublicKey(email: string): Promise<DiscoveredKey | null> {
  return (await lookupViaWkd(email)) ?? (await lookupViaKeyserver(email))
}

export interface PublishResult {
  fingerprint: string
  /** Per-address publication state as reported by the keyserver (e.g. "pending" until verified). */
  status: Record<string, string>
}

export async function publishToKeyserver(publicKeyArmored: string): Promise<PublishResult> {
  const response = await fetchWithTimeout(`${KEYSERVER_BASE}/vks/v1/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keytext: publicKeyArmored })
  })

  if (!response.ok) {
    throw appError('keyserverRejected', String(response.status))
  }

  const body = (await response.json()) as {
    key_fpr: string
    status: Record<string, string>
  }
  return { fingerprint: body.key_fpr, status: body.status ?? {} }
}
