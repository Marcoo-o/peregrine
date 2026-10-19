import DOMPurify from 'dompurify'

/**
 * One sanitising step for every route a message body can take out of the database.
 *
 * It used to be written out twice, once in the reading pane and once for printing, and the two
 * had already drifted: printing allowed `mailto:` that the reader did not, and the reader gained
 * fixes that printing never got. Whichever copy is weaker is the one an attacker uses, so there
 * is now a single set of rules and the callers only choose whether remote URLs are permitted.
 */

/**
 * The presentational attributes HTML mail is actually built on.
 *
 * These were being stripped, and that turned out to be why messages looked wrong. Nothing to do
 * with stylesheets: measured on a typical newsletter, the `<style>` block survives untouched,
 * `@media` and `@font-face` included, while `<table width="600" cellpadding="0" align="center">`
 * came out as a bare `<table>`. Twenty years of mail is laid out with exactly these attributes,
 * so losing them turns a fixed width newsletter into a full width column with images at their
 * natural size.
 *
 * **They are declared URI safe rather than merely allowed**, and that distinction is the whole
 * fix. DOMPurify tests the *value* of every attribute it does not know to be free of URLs
 * against `ALLOWED_URI_REGEXP`. Ours demands an explicit scheme, so `600`, `#ffffff`, `top` and
 * `Arial` all failed it and the attributes were dropped. Adding them with `ADD_ATTR` changed
 * nothing, because the value test came first. Saying they carry no URL is what stops that test
 * running at all.
 *
 * `background` is deliberately absent. It really does take a URL, so it has to keep going
 * through the check, and a `background="javascript:..."` is refused there.
 */
const URI_FREE_LAYOUT_ATTRIBUTES = [
  'width', 'height', 'align', 'valign', 'bgcolor',
  'border', 'cellpadding', 'cellspacing', 'colspan', 'rowspan',
  'hspace', 'vspace', 'face', 'size', 'color', 'nowrap',
  'dir', 'lang', 'text', 'link', 'vlink', 'alink'
]

/**
 * Interactive elements have no place in a message.
 *
 * DOMPurify keeps `<form>` and `<input>` by default, so a message could render a working login
 * form. The document's own CSP does not stop it either: `form-action` does not fall back to
 * `default-src`, so `default-src 'none'` leaves submission wide open. That is credential
 * phishing rendered by the mail client itself, and it was reachable until this list existed.
 *
 * A message that wants a form can link to one, which goes through the link check like any other
 * link and shows the user where it leads.
 */
const INTERACTIVE_TAGS = ['form', 'input', 'button', 'select', 'textarea', 'option', 'label']

/**
 * Schemes a URL in a message may use.
 *
 * An explicit list rather than a list of what to block. `javascript:` and `vbscript:` are the
 * obvious ones, but so are `file:` reading off the local disk and the handler schemes any
 * installed application can register, and those cannot be enumerated in advance.
 */
const REMOTE_SCHEMES = /^(?:https?|cid|data|mailto):/i
const LOCAL_SCHEMES = /^(?:cid|data|mailto):/i

export interface SanitizeOptions {
  /** Whether URLs pointing at the sender's servers may stay in the document. */
  allowRemote: boolean
  /** Whether the input is a full document rather than a fragment. */
  wholeDocument: boolean
}

export function sanitizeMailHtml(html: string, options: SanitizeOptions): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_URI_REGEXP: options.allowRemote ? REMOTE_SCHEMES : LOCAL_SCHEMES,
    WHOLE_DOCUMENT: options.wholeDocument,
    ADD_URI_SAFE_ATTR: URI_FREE_LAYOUT_ATTRIBUTES,
    FORBID_TAGS: INTERACTIVE_TAGS
  })
}

export interface SanitizedParts {
  /** The message's own stylesheets, in the order it declared them. */
  styles: string[]
  /** Everything inside `<body>`. */
  body: string
}

/**
 * Sanitises a message and hands back its stylesheet and its body separately.
 *
 * For callers that have to place a message inside a page of their own. Sanitising as a fragment
 * would be simpler, but a fragment loses the `<style>` block entirely, which is how printing
 * came to drop the styling that the reading pane was showing. A newsletter printed that way
 * comes out as unstyled stacked cells and looks nothing like what is on screen.
 *
 * Splitting rather than concatenating leaves the caller in charge of where the message's rules
 * sit relative to its own, which matters because CSS from a message is not scoped to it.
 */
export function sanitizeMailParts(html: string, allowRemote: boolean): SanitizedParts {
  const clean = sanitizeMailHtml(html, { allowRemote, wholeDocument: true })
  const parsed = new DOMParser().parseFromString(clean, 'text/html')
  return {
    // Only the head: a `<style>` further down stays where it is and comes along with the body.
    // The parser ends a style element at `</style` whatever the surrounding CSS says, so the
    // text cannot carry that sequence, and the replacement below is there to keep it that way
    // if a future caller ever builds the string differently.
    styles: Array.from(parsed.querySelectorAll('head style'), (element) =>
      (element.textContent ?? '').replace(/<\/style/gi, '')
    ),
    body: parsed.body.innerHTML
  }
}
