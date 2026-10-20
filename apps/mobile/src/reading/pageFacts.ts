import type { PageFacts, PageImage, PageLink } from './assessment'

const MAX_ENTRIES = 500
const MAX_URL = 2000
const MAX_TEXT = 300
const MAX_STYLE = 500

/** The tallest a page is taken to be. A page that says more is a page that wants a view that big. */
export const MAX_PAGE_HEIGHT = 50000

/**
 * What runs inside the page of a message, once it has loaded: it asks the page for its links and images and
 * for how tall it is, and reports them to the application, and again when the height changes. It is the only
 * script there is. The policy the page is served under lets no script of the message run, and this one is not
 * run by the page but put into it by the application, which the policy does not apply to.
 *
 * It reports and does not decide. What the links are worth is for `assessment.ts`, outside the page.
 */
export const MAIL_PAGE_SCRIPT = `
(function () {
  var MAX = ${MAX_ENTRIES};
  function all(selector) { return Array.prototype.slice.call(document.querySelectorAll(selector), 0, MAX); }
  function send(message) { window.ReactNativeWebView.postMessage(JSON.stringify(message)); }
  var links = all('a[href]').map(function (a) {
    return { href: a.getAttribute('href') || '', text: (a.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, ${MAX_TEXT}) };
  });
  var images = all('img').map(function (i) {
    return { src: i.getAttribute('src') || '', width: i.getAttribute('width'), height: i.getAttribute('height'), style: i.getAttribute('style') || '' };
  });
  send({ kind: 'page', links: links, images: images });
  function height() { send({ kind: 'height', height: Math.ceil(document.body.getBoundingClientRect().height) }); }
  height();
  if (window.ResizeObserver) new ResizeObserver(height).observe(document.body);
})();
true;
`

/** What the page said: what is in it, or how tall it is. */
export type PageMessage = { kind: 'page'; facts: PageFacts } | { kind: 'height'; height: number }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function linkOf(value: unknown): PageLink | null {
  if (!isRecord(value) || typeof value.href !== 'string') return null
  return { href: value.href.slice(0, MAX_URL), text: typeof value.text === 'string' ? value.text.slice(0, MAX_TEXT) : '' }
}

function imageOf(value: unknown): PageImage | null {
  if (!isRecord(value) || typeof value.src !== 'string') return null
  const size = (field: unknown): string | null => (typeof field === 'string' ? field.slice(0, 20) : null)
  return {
    src: value.src.slice(0, MAX_URL),
    width: size(value.width),
    height: size(value.height),
    style: typeof value.style === 'string' ? value.style.slice(0, MAX_STYLE) : ''
  }
}

function listOf<T>(value: unknown, read: (entry: unknown) => T | null): T[] {
  return (value as unknown[]).slice(0, MAX_ENTRIES).map(read).filter((entry): entry is T => entry !== null)
}

/**
 * What the page said, or null when it is not a message of a kind the script sends. What comes out of a page is
 * never taken as it is: it is read field by field, and what is too long or of the wrong kind is cut or left.
 */
export function parsePageMessage(data: string): PageMessage | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null

  if (parsed.kind === 'height') {
    if (typeof parsed.height !== 'number' || !Number.isFinite(parsed.height)) return null
    return { kind: 'height', height: Math.min(MAX_PAGE_HEIGHT, Math.max(0, parsed.height)) }
  }
  if (parsed.kind === 'page' && Array.isArray(parsed.links) && Array.isArray(parsed.images)) {
    return { kind: 'page', facts: { links: listOf(parsed.links, linkOf), images: listOf(parsed.images, imageOf) } }
  }
  return null
}
