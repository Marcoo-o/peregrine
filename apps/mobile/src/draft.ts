import type { ComposeInput, EmailAddress } from '@peregrine/core/types'
import { parseAddress } from '@peregrine/smtp/headers'
import type { ReadableMessage } from './messageText'

/** A message as the compose screen holds it: what was typed, before it is checked. */
export interface Draft {
  to: string
  cc: string
  subject: string
  body: string
  inReplyTo?: string
  references?: string
}

export const emptyDraft: Draft = { to: '', cc: '', subject: '', body: '' }

/**
 * Splits a list of addresses as it is typed, at commas and semicolons that are not inside a name in
 * quotes or an address in angle brackets: `"Anna, B" <a@example.net>, c@example.net` is two.
 */
export function splitAddressList(text: string): string[] {
  const parts: string[] = []
  let current = ''
  let quoted = false
  let angled = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '\\' && quoted) {
      current += c + (text[++i] ?? '')
      continue
    }
    if (c === '"') quoted = !quoted
    else if (!quoted && c === '<') angled = true
    else if (!quoted && c === '>') angled = false
    if ((c === ',' || c === ';') && !quoted && !angled) {
      parts.push(current)
      current = ''
    } else current += c
  }
  parts.push(current)
  return parts.map((part) => part.trim()).filter((part) => part !== '')
}

/** The addresses of a typed list. Whether each is one is for the composer to say when it is sent. */
export function parseAddressList(text: string): EmailAddress[] {
  return splitAddressList(text).map((part) => {
    const { name, address } = parseAddress(part)
    return { name: name ?? '', address }
  })
}

/** "Re: " once, however many answers the subject has been through. */
export function replySubject(subject: string): string {
  return /^\s*re:/i.test(subject) ? subject.trim() : `Re: ${subject.trim()}`.trim()
}

/**
 * The start of an answer to a message: the Reply-To address or else the sender, the subject, the thread
 * it belongs to and the original quoted line by line.
 */
export function replyDraft(message: ReadableMessage): Draft {
  const quoted = message.text
    .replace(/\r\n/g, '\n')
    .replace(/\n+$/, '')
    .split('\n')
    .map((line) => (line.startsWith('>') ? `>${line}` : `> ${line}`).trimEnd())
    .join('\n')
  const heading = `Am ${message.date || 'einem früheren Zeitpunkt'} schrieb ${message.from || 'der Absender'}:`
  const references = [message.references, message.messageId].filter((value) => value !== '').join(' ')
  return {
    to: message.replyTo || message.from,
    cc: '',
    subject: replySubject(message.subject),
    body: `\n\n${heading}\n${quoted}\n`,
    inReplyTo: message.messageId || undefined,
    references: references || undefined
  }
}

/** The input of the queue and of sending, from what was typed. */
export function toComposeInput(accountId: string, draft: Draft): ComposeInput {
  return {
    accountId,
    to: parseAddressList(draft.to),
    cc: parseAddressList(draft.cc),
    bcc: [],
    subject: draft.subject,
    textBody: draft.body,
    htmlBody: '',
    attachments: [],
    inReplyTo: draft.inReplyTo,
    references: draft.references
  }
}

/** Whether there is anything to send to: the screen enables its button on this. */
export function hasRecipient(draft: Draft): boolean {
  return splitAddressList(`${draft.to},${draft.cc}`).length > 0
}
