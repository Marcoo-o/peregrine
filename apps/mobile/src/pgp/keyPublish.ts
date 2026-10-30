/** What publishing needs of the network: a POST of JSON, and the answer as far as it is read here. */
export type Poster = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

/** The keyserver the application looks keys up on, which is also where it publishes: the lookup and the publishing are one trust. */
export const KEYSERVER = 'https://keys.openpgp.org'

/** How long the server has to answer. The user waits. */
const TIMEOUT_MS = 15_000

export type PublishFailure = 'unreachable' | 'refused'

export class PublishError extends Error {
  constructor(
    readonly failure: PublishFailure,
    readonly detail?: string
  ) {
    super(failure)
  }
}

/** What came of publishing: the key is on the server, and the address is either to be confirmed by a mail the server sent, or was confirmed before. */
export interface Published {
  fingerprint: string
  /** The address is confirmed already: the key can be found by it. */
  confirmed: boolean
  /** The server sent a mail with a link that confirms the address. */
  mailSent: boolean
}

async function post(poster: Poster, path: string, body: unknown, timeoutMs: number): Promise<{ status: number; body: Record<string, unknown> }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await poster(`${KEYSERVER}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    })
    const parsed = (await response.json().catch(() => ({}))) as Record<string, unknown>
    if (!response.ok) throw new PublishError('refused', typeof parsed.error === 'string' ? parsed.error : `Der Server antwortete mit ${response.status}.`)
    return { status: response.status, body: parsed }
  } catch (error) {
    if (error instanceof PublishError) throw error
    throw new PublishError('unreachable')
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Publishes a public key on keys.openpgp.org, in the way that server asks for: the key is uploaded and is then only a key that nobody can find by an
 * address. Each address in it has to be confirmed by a mail that the server sends to that address with a link, and only then is the key found by it.
 * So this uploads, and asks for that mail for the address that was given; it does not claim to have published anything that is not.
 *
 * Only called when the user asks: it makes the key and its address public, for good (the server can hide an address, it cannot take a key back).
 */
export async function publishKey(publicKey: string, address: string, poster: Poster, timeoutMs: number = TIMEOUT_MS): Promise<Published> {
  const uploaded = await post(poster, '/vks/v1/upload', { keytext: publicKey }, timeoutMs)
  const fingerprint = typeof uploaded.body.key_fpr === 'string' ? uploaded.body.key_fpr : ''
  const token = typeof uploaded.body.token === 'string' ? uploaded.body.token : ''
  const statuses = (uploaded.body.status ?? {}) as Record<string, unknown>
  const wanted = address.trim().toLowerCase()
  const status = Object.entries(statuses).find(([email]) => email.toLowerCase() === wanted)?.[1]
  if (status === 'published') return { fingerprint, confirmed: true, mailSent: false }
  if (!token) throw new PublishError('refused', 'Der Server hat die Adresse nicht in dem Schlüssel gefunden.')
  await post(poster, '/vks/v1/request-verify', { token, addresses: [address.trim()], locale: ['de'] }, timeoutMs)
  return { fingerprint, confirmed: false, mailSent: true }
}
