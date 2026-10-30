import { discoverMailConfig, type FetchText } from '@peregrine/core/mailDiscovery'
import { findPresetForEmail } from '@peregrine/core/providerPresets'
import type { SecureMode } from '@peregrine/core/types'

/** Where the settings that were found came from: the application's own list of the large providers, or what the address's domain publishes. */
export type FoundBy = 'preset' | 'provider' | 'wellKnown' | 'mozilla' | 'srv'

/** The servers of an address, as the form needs them. */
export interface FoundServers {
  source: FoundBy
  imap: { host: string; port: number; secure: SecureMode; username: string }
  smtp: { host: string; port: number; secure: SecureMode }
  /** For a provider of the application's list: its name. */
  label?: string
  /** The provider only takes OAuth2, which the application cannot do: the login that the form asks for cannot be used. */
  oauth2: boolean
  /** For a provider that wants an app password instead of the one of the account: where to make one. */
  appPasswordUrl?: string
}

/** A document is a few kilobytes; what is larger is not one. */
const MAX_CHARS = 256 * 1024

/** How long a server has to answer, for each document. The user waits for the slowest. */
const TIMEOUT_MS = 5000

/** What fetching needs of the platform: the answer to a request, as far as it is read here. */
export type Fetcher = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{ ok: boolean; text(): Promise<string> }>

/**
 * Gets a document or gives it up. Two timeouts, as on the desktop: the abort stops a request that is under way, and the race ends the wait for one
 * that is not (a name that does not resolve holds the promise whatever the signal says).
 */
export function textFetcher(fetcher: Fetcher, timeoutMs: number = TIMEOUT_MS): FetchText {
  return async (url) => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const gaveUp = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        controller.abort()
        resolve(null)
      }, timeoutMs)
    })
    const request = (async (): Promise<string | null> => {
      try {
        const response = await fetcher(url, { signal: controller.signal, headers: { Accept: 'application/xml, text/xml' } })
        if (!response.ok) return null
        const text = await response.text()
        return text.length > MAX_CHARS ? null : text
      } catch {
        // Any failure is simply "this source has nothing".
        return null
      }
    })()
    try {
      return await Promise.race([request, gaveUp])
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * Finds the servers of an address. The large providers are known by their domain and cost no request; for any other the domain is asked, as the desktop
 * asks it: the provider's own autoconfig, and then the database of Mozilla, which is told the domain and not the address. Returns null when nobody knows.
 */
export async function findServers(email: string, fetcher: Fetcher = fetch as unknown as Fetcher): Promise<FoundServers | null> {
  const preset = findPresetForEmail(email)
  if (preset) {
    return {
      source: 'preset',
      label: preset.label,
      imap: { host: preset.imapHost, port: preset.imapPort, secure: preset.imapSecure, username: email.trim() },
      smtp: { host: preset.smtpHost, port: preset.smtpPort, secure: preset.smtpSecure },
      oauth2: false,
      appPasswordUrl: preset.appPasswordUrl
    }
  }
  const result = await discoverMailConfig(email, textFetcher(fetcher))
  if (!result.found) return null
  const { config } = result
  return {
    source: result.source,
    imap: { host: config.imap.host, port: config.imap.port, secure: config.imap.secure, username: config.imap.username },
    smtp: { host: config.smtp.host, port: config.smtp.port, secure: config.smtp.secure },
    oauth2: config.imap.authType === 'oauth2' || config.smtp.authType === 'oauth2'
  }
}

/** What the screen says of what was found, or of finding nothing. */
export function foundText(found: FoundServers | null): string {
  if (!found) return 'Für diese Adresse sind keine Einstellungen veröffentlicht. Trage die Server selbst ein.'
  const where: Record<FoundBy, string> = {
    preset: `Bekannter Anbieter: ${found.label ?? ''}.`,
    provider: 'Gefunden beim Anbieter der Adresse.',
    wellKnown: 'Gefunden auf der Webseite der Domain der Adresse.',
    mozilla: 'Gefunden in der Datenbank von Mozilla. Dorthin ging nur die Domain, nicht die Adresse.',
    srv: 'Gefunden in den DNS-Einträgen der Domain.'
  }
  const parts = [where[found.source]]
  if (found.oauth2) {
    parts.push('Dieser Anbieter verlangt eine Anmeldung über OAuth2, die diese App noch nicht kann. Geht es mit einem App-Passwort, gib es als Passwort ein.')
  } else if (found.appPasswordUrl) {
    parts.push('Dieser Anbieter verlangt meist ein App-Passwort statt des Passworts des Kontos.')
  }
  return parts.join(' ')
}
