import type { MessageDetail } from '@peregrine/core/types'
import { sanitizeMailParts } from './sanitizeMail'

/**
 * Builds the page a message is printed from.
 *
 * Deliberately the same sanitising step the reading pane uses. Printing must not become a
 * second, more trusting route to the same HTML: a message that cannot script the reader must
 * not be able to script a print window either. The page is then handed to the main process as
 * a `peregrine-mail://` URL, exactly like the one on screen.
 *
 * Remote images follow what the reading pane is showing rather than a rule of their own. If
 * they are still blocked, they stay out of the print. Fetching from the sender's server
 * would tell them the message was opened. If the user has already allowed them, the sender
 * knows either way, and a print that silently differs from the screen would be the surprise.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function addressLine(list: { name?: string; address: string }[]): string {
  return list.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', ')
}

/** Print styling lives in the document itself: the print window loads nothing else. */
const PRINT_CSS = `
  @page { margin: 18mm 16mm; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 11pt;
         color: #111; margin: 0; }
  .peregrine-print-header { border-bottom: 1px solid #999; padding-bottom: 8pt;
                            margin-bottom: 12pt; }
  .peregrine-print-header h1 { font-size: 14pt; margin: 0 0 6pt; }
  .peregrine-print-header dl { display: grid; grid-template-columns: auto 1fr;
                               gap: 2pt 10pt; margin: 0; font-size: 10pt; }
  .peregrine-print-header dt { color: #555; }
  .peregrine-print-header dd { margin: 0; }
  .peregrine-print-body img { max-width: 100%; }
  /* A message may bring its own colours; on paper they are usually unreadable. */
  .peregrine-print-body { color: #111; }
  blockquote { border-left: 2pt solid #bbb; margin-left: 0; padding-left: 8pt; color: #444; }
`

export interface PrintLabels {
  from: string
  to: string
  cc: string
  date: string
}

export function buildPrintDocument(
  message: MessageDetail,
  labels: PrintLabels,
  /** Whether the reading pane is currently showing remote images. */
  showRemoteImages: boolean
): string {
  const parts = message.htmlBody ? sanitizeMailParts(message.htmlBody, showRemoteImages) : null
  const body =
    parts?.body ??
    `<pre style="white-space: pre-wrap; font-family: inherit">${escapeHtml(
      message.textBody ?? ''
    )}</pre>`

  const rows = [
    [labels.from, addressLine(message.from)],
    [labels.to, addressLine(message.to)],
    ...(message.cc.length > 0 ? [[labels.cc, addressLine(message.cc)]] : []),
    [labels.date, new Date(message.date).toLocaleString()]
  ]

  // The message's own rules go first, so that the print stylesheet has the last word on the
  // header it draws itself. CSS from a message is not scoped to the message, and a printout
  // whose sender decides what the header looks like would be worth very little.
  const messageCss = (parts?.styles ?? []).map((css) => `<style>${css}</style>`).join('')

  return `<!DOCTYPE html><html><head><meta charset="utf-8">${messageCss}<style>${PRINT_CSS}</style></head>
<body>
  <div class="peregrine-print-header">
    <h1>${escapeHtml(message.subject)}</h1>
    <dl>
      ${rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('\n      ')}
    </dl>
  </div>
  <div class="peregrine-print-body">${body}</div>
</body></html>`
}

/** A file name one can find again: date, sender and subject, stripped of what paths reject. */
export function suggestedPdfName(message: MessageDetail): string {
  const date = new Date(message.date)
  const day = Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
  const subject = (message.subject || 'Nachricht').slice(0, 60)
  return `${day} ${subject}`.replace(/[\\/:*?"<>|]/g, '-').trim() + '.pdf'
}
