import { mailContentCsp } from '@peregrine/core/mailCsp'

export interface MailDocumentOptions {
  /** The HTML of the message, as the sender wrote it. */
  html: string
  /** Whether images may be fetched from the sender's servers. They are not, until the user says so. */
  allowRemoteImages: boolean
  /** The images the message carries, by content id, as data URLs. */
  inlineImages: Record<string, string>
}

/** What a page of HTML mail is read on. Mail is written for a light page, so it gets one in the dark theme too. */
export const PAGE_BACKGROUND = '#ffffff'

const PAGE_STYLE = [
  `html,body{margin:0;padding:0;background:${PAGE_BACKGROUND};color:#1b1f24}`,
  'body{padding:12px;font:16px/1.5 sans-serif;overflow-wrap:anywhere}',
  'img{max-width:100%;height:auto}',
  'table{max-width:100%}',
  'pre{white-space:pre-wrap}',
  'a{color:#2f5d9f}'
].join('')

/**
 * Elements taken out of a message because nothing in a message needs them and each could be turned against
 * the reader. This is tidiness and not the barrier: it is a pattern over text and is not meant to be
 * trusted to keep anything out. What keeps a message from running or fetching anything is the policy the
 * document is served under, which comes before the first byte of the message and which a message cannot
 * unsay. Nothing it says changes what that policy allows.
 */
const REMOVED_WITH_CONTENT = /<(script|iframe|object|embed|noscript|title)\b[\s\S]*?<\/\1\s*>/gi
const REMOVED_TAGS = /<\/?(script|iframe|object|embed|noscript|title|base|meta|link|html|head|body)\b[^>]*>/gi

/** Puts the data of an inline image where the message names it by content id. */
function withInlineImages(html: string, images: Record<string, string>): string {
  return html.replace(/cid:([^"'\s)<>]+)/gi, (whole, id: string) => {
    let name = id
    try {
      name = decodeURIComponent(id)
    } catch {
      // not percent-encoded, which is also how it is written
    }
    return images[name] ?? images[id] ?? whole
  })
}

/**
 * The page a message is shown on: the policy first, the fit to a phone, and then the content of the message
 * without the page it came with. Images from outside are only allowed when the user asked for them.
 */
export function buildMailDocument(options: MailDocumentOptions): string {
  const policy = mailContentCsp({ surface: 'reader', allowRemoteImages: options.allowRemoteImages })
  const content = withInlineImages(options.html, options.inlineImages)
    .replace(REMOVED_WITH_CONTENT, '')
    .replace(REMOVED_TAGS, '')
  return [
    '<!doctype html><html><head>',
    `<meta http-equiv="Content-Security-Policy" content="${policy}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<style>${PAGE_STYLE}</style>`,
    '</head><body>',
    content,
    '</body></html>'
  ].join('')
}
