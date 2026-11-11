import { safeHttpsUrl } from '@peregrine/core/unsubscribe'
import { t } from './i18n'

/** Asks a mailing list to take the address off with one request, which is all that "one click" is (RFC 8058). */
export interface Unsubscriber {
  /** Raises why it did not work: the address is not one to go to, there was no answer in time, or the server did not take it. */
  post(url: string): Promise<void>
}

/** What `fetch` is, as far as this needs it, so that a test can stand in for the network. */
export type Fetcher = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string; credentials: 'omit'; cache: 'no-store'; signal: AbortSignal }
) => Promise<{ ok: boolean; status: number }>

/**
 * One POST with the body that RFC 8058 names and nothing that identifies the user beyond what the address already carries: no cookies, no login, no
 * referrer. The address is checked here again, so that whoever calls does not have to remember to. A server that redirects is followed, as the platform's
 * network does for every request; that is as far as this can limit where a request goes.
 */
export class FetchUnsubscriber implements Unsubscriber {
  constructor(
    private readonly fetcher: Fetcher,
    private readonly timeoutMs = 15_000
  ) {}

  async post(url: string): Promise<void> {
    if (!safeHttpsUrl(url)) throw new Error(t('Die Adresse zum Abmelden ist nicht sicher genug'))
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetcher(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal
      })
      if (!response.ok) throw new Error(t('Der Server hat mit {status} geantwortet', { status: response.status }))
    } catch (error) {
      if (controller.signal.aborted) throw new Error(t('Der Server hat nicht rechtzeitig geantwortet'))
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
}
