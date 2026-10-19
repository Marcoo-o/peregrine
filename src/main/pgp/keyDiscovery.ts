import { appError } from '@peregrine/core/errorText'
import { createHash } from 'node:crypto'
import { normalizeDiscoveredKey } from './pgpService'

const KEYSERVER_BASE = 'https://keys.openpgp.org'
const REQUEST_TIMEOUT_MS = 10_000

/** z-base-32 alphabet as specified for WKD hashed local parts (RFC draft / GnuPG WKD). */
const ZBASE32_ALPHABET = 'ybndrfg8ejkmcpqxot1uwisza345h769'

function zBase32Encode(bytes: Buffer): string {
  let bitBuffer = 0
  let bitCount = 0
  let out = ''
  for (const byte of bytes) {
    bitBuffer = (bitBuffer << 8) | byte
    bitCount += 8
    while (bitCount >= 5) {
      out += ZBASE32_ALPHABET[(bitBuffer >>> (bitCount - 5)) & 31]
      bitCount -= 5
    }
  }
  if (bitCount > 0) {
    out += ZBASE32_ALPHABET[(bitBuffer << (5 - bitCount)) & 31]
  }
  return out
}

/** WKD maps the lowercased local part through SHA-1 and z-base-32 into a fixed 32-char name. */
function wkdLocalPartHash(localPart: string): string {
  const digest = createHash('sha1').update(localPart.toLowerCase(), 'utf8').digest()
  return zBase32Encode(digest)
}

function splitAddress(email: string): { localPart: string; domain: string } | null {
  const at = email.lastIndexOf('@')
  if (at <= 0 || at === email.length - 1) return null
  return { localPart: email.slice(0, at), domain: email.slice(at + 1).toLowerCase() }
}

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
  const parts = splitAddress(email)
  if (!parts) return null
  const hashed = wkdLocalPartHash(parts.localPart)
  const encodedLocal = encodeURIComponent(parts.localPart)

  const advanced = `https://openpgpkey.${parts.domain}/.well-known/openpgpkey/${parts.domain}/hu/${hashed}?l=${encodedLocal}`
  const direct = `https://${parts.domain}/.well-known/openpgpkey/hu/${hashed}?l=${encodedLocal}`

  for (const url of [advanced, direct]) {
    const key = await tryFetchKey(url, 'WKD')
    if (key) return key
  }
  return null
}

/** keys.openpgp.org VKS lookup; only returns addresses whose owner opted in to publication. */
export async function lookupViaKeyserver(email: string): Promise<DiscoveredKey | null> {
  return tryFetchKey(
    `${KEYSERVER_BASE}/vks/v1/by-email/${encodeURIComponent(email)}`,
    'keys.openpgp.org'
  )
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
