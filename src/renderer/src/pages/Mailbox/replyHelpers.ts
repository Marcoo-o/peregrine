import type { EmailAddress, MessageDetail } from '@peregrine/core/types'
import type { ComposeInitialValues } from '@renderer/components/ComposeEditor'

function quote(message: MessageDetail): string {
  const body = message.textBody ?? ''
  const quoted = body
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
  const from = message.from.map((a) => a.name || a.address).join(', ')
  return `\n\nOn ${message.date}, ${from} wrote:\n${quoted}`
}

function references(message: MessageDetail): string {
  const existing = message.referencesHeader ?? ''
  const id = message.messageIdHeader ?? ''
  return [existing, id].filter(Boolean).join(' ')
}

function joinAddresses(addresses: EmailAddress[]): string {
  return addresses.map((a) => a.address).join(', ')
}

/** Drops the replying identity from a recipient list so a reply-all never mails oneself. */
function withoutSelf(addresses: EmailAddress[], ownAddress: string | undefined): EmailAddress[] {
  const own = ownAddress?.toLowerCase()
  const seen = new Set<string>()
  return addresses.filter((address) => {
    const key = address.address.toLowerCase()
    if (!key || key === own || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function buildReply(message: MessageDetail): ComposeInitialValues {
  return {
    to: joinAddresses(message.from),
    subject: message.subject.toLowerCase().startsWith('re:')
      ? message.subject
      : `Re: ${message.subject}`,
    textBody: quote(message),
    inReplyTo: message.messageIdHeader ?? undefined,
    references: references(message)
  }
}

export function buildReplyAll(
  message: MessageDetail,
  ownAddress: string | undefined
): ComposeInitialValues {
  const reply = buildReply(message)
  return {
    ...reply,
    to: joinAddresses(withoutSelf([...message.from, ...message.to], ownAddress)),
    cc: joinAddresses(withoutSelf(message.cc, ownAddress))
  }
}

export function buildForward(message: MessageDetail): ComposeInitialValues {
  return {
    to: '',
    subject: message.subject.toLowerCase().startsWith('fwd:')
      ? message.subject
      : `Fwd: ${message.subject}`,
    textBody: quote(message)
  }
}
