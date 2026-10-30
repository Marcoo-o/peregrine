import { keyserverUrl, splitAddress, wkdUrls } from '@peregrine/core/keyLookup'
import { sha1 } from '@noble/hashes/legacy'
import { encodeUtf8 } from '@peregrine/imap/utf8'
import { scanKeys, type ScannedKey } from './pgpService'

/** Where a key was found: in the directory of the address's own domain, or on the keyserver. */
export type KeySource = 'WKD' | 'keys.openpgp.org'

export interface LookedUpKeys {
  source: KeySource
  /** The keys that name the address that was asked for, as public keys. */
  keys: ScannedKey[]
}

/** What lookup needs of fetching: the answer to a request, as far as it is read here. */
export type Fetcher = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; arrayBuffer(): Promise<ArrayBuffer> }>

/** A key is some kilobytes. What is bigger is not one, or is not worth reading from a server that gave it unasked. */
const MAX_BYTES = 512 * 1024

/** How long a server has to answer: it is the user who waits. */
const TIMEOUT_MS = 10_000

/** Why nothing was found: the servers answered and had no key, or none of them could be reached. */
export type LookupFailure = 'notFound' | 'unreachable' | 'notAnAddress'

export class KeyLookupError extends Error {
  constructor(readonly failure: LookupFailure) {
    super(failure)
  }
}

/**
 * Looks for the public key of an address where it is published, in the order the desktop does it: the Web Key Directory of the
 * address's domain first (on its `openpgpkey` subdomain, then on the domain itself), then keys.openpgp.org. The first that has a
 * key for the address is the answer.
 *
 * Asking tells the server which address the user is about to write to, so this is called only when the user asks, for one
 * address, and never to find out for them.
 *
 * What a server gives is taken only if it is a key and one of its user IDs is the address that was asked for: a server could give
 * any key. It is given as a public key whatever the file holds, and it is not stored: the user places it like any other.
 * Throws a `KeyLookupError` when nothing was found.
 */
export async function lookupKey(address: string, fetcher: Fetcher = fetch as unknown as Fetcher, timeoutMs: number = TIMEOUT_MS): Promise<LookedUpKeys> {
  const wanted = splitAddress(address)
  if (!wanted) throw new KeyLookupError('notAnAddress')
  const asked = `${wanted.localPart.toLowerCase()}@${wanted.domain}`

  const candidates: { url: string; source: KeySource }[] = [
    ...wkdUrls(address, sha1, encodeUtf8).map((url) => ({ url, source: 'WKD' as const })),
    { url: keyserverUrl(address), source: 'keys.openpgp.org' as const }
  ]
  let answered = 0
  for (const { url, source } of candidates) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetcher(url, { signal: controller.signal })
      answered += 1
      if (!response.ok) continue
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.length === 0 || bytes.length > MAX_BYTES) continue
      const keys = (await scanKeys(bytes))
        .filter((key) => key.addresses.includes(asked))
        .map((key) => ({ ...key, privateKey: undefined, locked: false }))
      if (keys.length > 0) return { source, keys }
    } catch {
      // This one did not answer, or what it gave is no key: the next may have it.
    } finally {
      clearTimeout(timer)
    }
  }
  throw new KeyLookupError(answered === 0 ? 'unreachable' : 'notFound')
}
