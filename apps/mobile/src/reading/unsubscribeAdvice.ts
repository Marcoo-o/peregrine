import { adviseUnsubscribe, parseUnsubscribe, type UnsubscribeAdvice, type UnsubscribeOptions } from '@peregrine/core/unsubscribe'
import type { ReadableMessage } from '../messageText'
import type { MessageAssessment } from './assessment'

/** What a message offers for leaving its list, with what is made of that given what is known about the message. */
export interface UnsubscribeOffer {
  options: UnsubscribeOptions
  /** The domain of the address the message is from. */
  senderDomain: string
  advice: UnsubscribeAdvice
}

/**
 * Whether and how the message can be unsubscribed from. Nothing when it offers nothing that is safe to use. A message that looks wrong (the server called
 * it spam, an authentication check failed, or the sender looks like somebody else) is offered no way: see `adviseUnsubscribe`.
 */
export function unsubscribeOffer(message: ReadableMessage | undefined, assessment: MessageAssessment | undefined, senderAddress: string): UnsubscribeOffer | null {
  if (!message) return null
  const options = parseUnsubscribe(message.headers['list-unsubscribe'], message.headers['list-unsubscribe-post'])
  if (!options) return null
  const senderDomain = senderAddress.slice(senderAddress.lastIndexOf('@') + 1).toLowerCase()
  const suspicious = Boolean(assessment && (assessment.spam !== null || assessment.failedAuth.length > 0 || assessment.sender.length > 0))
  return { options, senderDomain, advice: adviseUnsubscribe(options, { suspicious, firstContact: assessment?.firstContact ?? false, senderDomain }) }
}
