import { buildMailDocument } from './reading/mailDocument'
import type { ReadableMessage } from './messageText'

/** The system's print service, which also makes a PDF of a page. The native module is behind it. */
export interface Printer {
  /** Hands a page of HTML to the print service under the name of a job. Resolves once the service has it. */
  print(jobName: string, html: string): Promise<void>
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/** A name for the job and for the PDF that the service proposes: the subject, without what a file cannot be called. */
export function jobNameOf(subject: string): string {
  const name = subject.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  return name === '' ? 'Nachricht' : name
}

/** The lines above a message on paper: who it is from and to and when, as the message says them. A line that the message does not have is left out. */
function headerOf(message: ReadableMessage): string {
  const rows: Array<[string, string]> = [
    ['Von', message.from],
    ['An', message.to],
    ['Kopie', message.cc],
    ['Datum', message.date]
  ]
  const lines = rows
    .filter(([, value]) => value.trim() !== '')
    .map(([label, value]) => `<tr><th style="text-align:left;padding-right:12px;color:#5c6570;font-weight:600;vertical-align:top">${label}</th><td>${escapeHtml(value)}</td></tr>`)
    .join('')
  return `<h1 style="font-size:20px;margin:0 0 8px">${escapeHtml(message.subject || '(ohne Betreff)')}</h1><table style="margin-bottom:12px;border-collapse:collapse">${lines}</table><hr>`
}

/**
 * The page that a message is printed on: the lines above it, and then its text as it is read. Images that the message fetches from the sender's servers
 * are not: paper cannot ask, so the answer is the one the reader gives before the user says otherwise, and a print is not a reason for a sender to learn
 * that the message was read. A message that is only text is set in a type that keeps its lines.
 */
export function printDocumentOf(message: ReadableMessage): { jobName: string; html: string } {
  const body = message.html !== null ? message.html : `<pre style="font:inherit;white-space:pre-wrap">${escapeHtml(message.text)}</pre>`
  const html = buildMailDocument({ html: body, inlineImages: message.inlineImages, allowRemoteImages: false, header: headerOf(message) })
  return { jobName: jobNameOf(message.subject), html }
}
