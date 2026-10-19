import { protocol } from 'electron'
import { randomUUID } from 'node:crypto'

export const MAIL_CONTENT_SCHEME = 'peregrine-mail'

interface PublishedContent {
  html: string
  csp: string
}

const store = new Map<string, PublishedContent>()
const MAX_ENTRIES = 30

export function registerMailContentSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MAIL_CONTENT_SCHEME,
      privileges: {
        standard: false,
        secure: true,
        supportFetchAPI: false,
        corsEnabled: false,
        bypassCSP: false
      }
    }
  ])
}

export function registerMailContentProtocolHandler(): void {
  protocol.handle(MAIL_CONTENT_SCHEME, (request) => {
    const token = new URL(request.url).hostname
    const entry = store.get(token)
    if (!entry) {
      return new Response('Not found', { status: 404 })
    }
    return new Response(entry.html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': entry.csp
      }
    })
  })
}

/** Publishes sanitized message HTML so it can be loaded as its own document with its own
 * CSP response header. Independent of the app shell's CSP, unlike `srcdoc`/`data:` iframes,
 * which Chromium additionally binds to the embedding page's policy. */
export function publishMailContent(html: string, csp: string): string {
  const token = randomUUID()
  store.set(token, { html, csp })
  if (store.size > MAX_ENTRIES) {
    const oldestKey = store.keys().next().value
    if (oldestKey) store.delete(oldestKey)
  }
  return `${MAIL_CONTENT_SCHEME}://${token}/`
}
