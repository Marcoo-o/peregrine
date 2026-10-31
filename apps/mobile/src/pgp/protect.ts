import type { SqlDb } from '@peregrine/core/sqlDb'
import { composeMessage, composeProtected, type AddressInput, type Composed, type ComposeInput, type ComposeOptions } from '@peregrine/smtp/compose'
import { parseAddress } from '@peregrine/smtp/headers'
import { encryptedBody, signedBody } from '@peregrine/smtp/pgpMime'
import { loadKeyChoice, preferFirst } from './keyChoice'
import { addressKey, contactKeysFor, listOwnKeys, type OwnKey } from './keyStore'
import { encryptEntity, keyState, signEntity, type KeyState } from './pgpService'
import { t, msg } from '../i18n'

/** What is asked of a message: that it be readable only by those it goes to, that it say who wrote it, or both. */
export interface Protection {
  encrypt: boolean
  sign: boolean
}

const addressOf = (address: AddressInput): string => parseAddress(address).address

/** Everybody the message goes to, once each, whatever case the address is written in. */
function recipientsOf(input: ComposeInput): string[] {
  const all = [...input.to, ...(input.cc ?? []), ...(input.bcc ?? [])].map(addressOf)
  return [...new Map(all.map((address) => [address.toLowerCase(), address])).values()]
}

/** Why the newest key of a person cannot be used, when none of those held can. */
type KeyFault = 'expired' | 'revoked' | 'unusable'

const faultOf = (state: KeyState): KeyFault =>
  state.revoked ? 'revoked' : state.expiresAt !== null && new Date(state.expiresAt) <= new Date() ? 'expired' : 'unusable'

/**
 * The key to encrypt to for an address: the newest of those held that can still encrypt. A person who has changed keys has
 * the old one held as well, and an old one that has expired is no reason not to use the new one. When none can, the fault
 * of the newest says why.
 */
async function recipientKey(db: SqlDb, address: string): Promise<{ publicKey: string } | { fault: KeyFault | 'missing' }> {
  const held = preferFirst(await contactKeysFor(db, address), (await loadKeyChoice(db)).recipient[addressKey(address)])
  if (held.length === 0) return { fault: 'missing' }
  let newest: KeyFault | undefined
  for (const key of held) {
    const state = await keyState(key.publicKey)
    if (state.canEncrypt && !state.revoked) return { publicKey: key.publicKey }
    newest ??= faultOf(state)
  }
  return { fault: newest ?? 'unusable' }
}

/** The key of an account that signs: the newest that can still sign, or the fault of the newest when none can. */
async function usableOwnKey(db: SqlDb, accountId: string): Promise<{ key: OwnKey } | { fault: KeyFault | 'missing' }> {
  const held = preferFirst(await listOwnKeys(db, accountId), (await loadKeyChoice(db)).signing[accountId])
  if (held.length === 0) return { fault: 'missing' }
  let newest: KeyFault | undefined
  for (const key of held) {
    const state = await keyState(key.publicKey)
    if (state.canSign && state.canEncrypt && !state.revoked) return { key }
    newest ??= faultOf(state)
  }
  return { fault: newest ?? 'unusable' }
}

const FAULT_WORDS: Record<KeyFault, string> = { expired: msg('abgelaufen'), revoked: msg('widerrufen'), unusable: msg('nicht zu gebrauchen') }

/**
 * Why a message cannot be protected as asked, in the words of the screen, or null when it can. The compose screen asks
 * before anything is put into the queue, and the composing asks again, so that a message that was asked to be
 * encrypted never goes out in the clear.
 *
 * A draft that is encrypted is encrypted to its author alone, who is the only one who has to read it: the keys of the
 * recipients play no part, so that keeping it does not fail because of an address typed half an hour ago.
 */
export async function protectionProblem(
  db: SqlDb,
  accountId: string,
  protection: Protection,
  recipients: string[],
  options: { draft?: boolean } = {}
): Promise<string | null> {
  if (!protection.encrypt && !protection.sign) return null
  const own = await usableOwnKey(db, accountId)
  if ('fault' in own) {
    return own.fault === 'missing'
      ? t('Für dieses Konto gibt es keinen Schlüssel. In den Einstellungen lässt sich einer anlegen oder einlesen.')
      : t('Der Schlüssel dieses Kontos ist {n}. In den Einstellungen lässt sich ein neuer anlegen.', { n: t(FAULT_WORDS[own.fault]) })
  }
  if (!protection.encrypt || options.draft) return null
  const missing: string[] = []
  const faults: Record<KeyFault, string[]> = { expired: [], revoked: [], unusable: [] }
  for (const address of recipients) {
    const found = await recipientKey(db, address)
    if ('fault' in found) (found.fault === 'missing' ? missing : faults[found.fault]).push(address)
  }
  const parts = [
    missing.length > 0 ? t('Für {n} ist kein Schlüssel hinterlegt.', { n: missing.join(', ') }) : '',
    ...(Object.keys(faults) as KeyFault[]).map((fault) =>
      faults[fault].length > 0 ? t('Der Schlüssel für {n} ist {n2}.', { n: faults[fault].join(', '), n2: t(FAULT_WORDS[fault]) }) : ''
    )
  ].filter((part) => part !== '')
  return parts.length === 0 ? null : t('{n} Ohne einen gültigen Schlüssel lässt sich die Nachricht nicht verschlüsseln.', { n: parts.join(' ') })
}

/**
 * The message with its content signed or encrypted, as PGP/MIME (RFC 3156) does it and as the desktop writes it. Encrypting
 * signs as well: the recipient can tell a message that was encrypted by the sender from one that anybody encrypted to the key.
 * It is also encrypted to the sender's own key, so that it can be read in the Sent folder.
 *
 * A draft that is only to be signed is kept as it is, since a signature over something that is still being written says nothing.
 */
export async function composeProtectedMessage(
  db: SqlDb,
  accountId: string,
  protection: Protection,
  input: ComposeInput,
  options: ComposeOptions
): Promise<Composed> {
  const problem = await protectionProblem(db, accountId, protection, recipientsOf(input), options)
  if (problem) throw new Error(problem)
  const usable = await usableOwnKey(db, accountId)
  if ('fault' in usable) throw new Error(t('Für dieses Konto gibt es keinen Schlüssel, der sich gebrauchen ließe.'))
  const own = usable.key

  if (options.draft) {
    if (!protection.encrypt) return composeMessage(input, options)
    return composeProtected(input, options, async (entity) =>
      encryptedBody(await encryptEntity(entity.source, [own.publicKey]), options.random)
    )
  }
  if (protection.encrypt) {
    const keys: string[] = []
    for (const address of recipientsOf(input)) {
      const found = await recipientKey(db, address)
      if ('fault' in found) throw new Error(t('Für {address} gibt es keinen Schlüssel, der sich gebrauchen ließe.', { address }))
      keys.push(found.publicKey)
    }
    return composeProtected(input, options, async (entity) =>
      encryptedBody(await encryptEntity(entity.source, [...keys, own.publicKey], own.privateKey), options.random)
    )
  }
  return composeProtected(input, options, async (entity) =>
    signedBody(entity, await signEntity(entity.source, own.privateKey), options.random)
  )
}
