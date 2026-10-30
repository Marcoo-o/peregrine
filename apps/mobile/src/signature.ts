import type { Draft } from './draft'
import type { Identity } from './identities'

/**
 * The line that marks where a signature starts: two hyphens and a space, as it has been written since before mail had screens. It is
 * what lets a client, and a reader, tell a signature from the text above it, and what lets this one swap the signature when the
 * sender changes without touching anything that was typed.
 */
export const SIGNATURE_MARK = '-- '

/** The block a signature makes at the end of a message: two line breaks, the mark and the text. Nothing for a signature that is empty. */
function block(signature: string): string {
  const text = signature.replace(/\r\n?/g, '\n').trim()
  return text === '' ? '' : `\n\n${SIGNATURE_MARK}\n${text}`
}

/** The text of a message with a signature under it. */
export function withSignature(body: string, signature: string): string {
  const added = block(signature)
  return added === '' ? body : `${body.trimEnd()}${added}`
}

/**
 * The text without the signature, when it ends with exactly that one: what is typed above, or a signature that was changed by hand,
 * is not taken for it, and then nothing is cut.
 */
export function withoutSignature(body: string, signature: string): string {
  const added = block(signature)
  if (added === '') return body
  const trimmed = body.trimEnd()
  return trimmed.endsWith(added) ? trimmed.slice(0, trimmed.length - added.length) : body
}

/** The text with the signature of one identity taken out and the signature of another put in. */
export function swapSignature(body: string, from: string, to: string): string {
  return withSignature(withoutSignature(body, from), to)
}

/**
 * A draft written from another identity: the sender it names, and the signature under the text exchanged for the new one's. Only
 * when the old one is still as it was put there; a signature that was edited by hand is left where it is, and the new one is not
 * added over it, since two would be worse than the wrong one. When the old identity had none, the new one's is added.
 */
export function withIdentity(draft: Draft, from: Identity | undefined, to: Identity): Draft {
  const old = from?.signature ?? ''
  const stripped = withoutSignature(draft.body, old)
  const putThere = old.trim() !== '' && stripped !== draft.body
  const hadNone = old.trim() === ''
  let body = draft.body
  if (putThere) body = withSignature(stripped, to.signature)
  else if (hadNone) body = withSignature(draft.body, to.signature)
  return { ...draft, identityId: to.id, body }
}

/**
 * The identity of an account that a message was written from, when it names one by its address: the sender of a draft that is written
 * on again. Without a match, the default.
 */
export function identityForSender(identities: Identity[], sender: string): Identity | undefined {
  const address = /<([^<>]+)>\s*$/.exec(sender)?.[1] ?? sender
  const wanted = address.trim().toLowerCase()
  return identities.find((identity) => identity.emailAddress.toLowerCase() === wanted) ?? identities[0]
}
