import type { SqlDb } from '@peregrine/core/sqlDb'
import { composeMessage, composeProtected, type AddressInput, type Composed, type ComposeInput, type ComposeOptions } from '@peregrine/smtp/compose'
import { parseAddress } from '@peregrine/smtp/headers'
import { encryptedBody, signedBody } from '@peregrine/smtp/pgpMime'
import { contactKeysFor, signingKey } from './keyStore'
import { encryptEntity, signEntity } from './pgpService'

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
  if (!(await signingKey(db, accountId))) {
    return 'Für dieses Konto gibt es keinen Schlüssel. In den Einstellungen lässt sich einer anlegen oder einlesen.'
  }
  if (!protection.encrypt || options.draft) return null
  const missing: string[] = []
  for (const address of recipients) if ((await contactKeysFor(db, address)).length === 0) missing.push(address)
  return missing.length === 0
    ? null
    : `Für ${missing.join(', ')} ist kein Schlüssel hinterlegt. Ohne ihn lässt sich die Nachricht nicht verschlüsseln.`
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
  const own = await signingKey(db, accountId)
  if (!own) throw new Error('Für dieses Konto gibt es keinen Schlüssel.')

  if (options.draft) {
    if (!protection.encrypt) return composeMessage(input, options)
    return composeProtected(input, options, async (entity) =>
      encryptedBody(await encryptEntity(entity.source, [own.publicKey]), options.random)
    )
  }
  if (protection.encrypt) {
    const keys: string[] = []
    for (const address of recipientsOf(input)) keys.push((await contactKeysFor(db, address))[0].publicKey)
    return composeProtected(input, options, async (entity) =>
      encryptedBody(await encryptEntity(entity.source, [...keys, own.publicKey], own.privateKey), options.random)
    )
  }
  return composeProtected(input, options, async (entity) =>
    signedBody(entity, await signEntity(entity.source, own.privateKey), options.random)
  )
}
