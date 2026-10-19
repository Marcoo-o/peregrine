import * as openpgp from 'openpgp'
import type { KeyFacts } from '@peregrine/core/keyHealth'

export interface GeneratedKeyPair {
  publicKeyArmored: string
  privateKeyArmored: string
  fingerprint: string
}

export async function generateKeyPair(name: string, email: string): Promise<GeneratedKeyPair> {
  const { privateKey, publicKey } = await openpgp.generateKey({
    type: 'ecc',
    curve: 'curve25519Legacy',
    userIDs: [{ name, email }],
    format: 'armored'
  })
  const readPublic = await openpgp.readKey({ armoredKey: publicKey })
  return {
    publicKeyArmored: publicKey,
    privateKeyArmored: privateKey,
    fingerprint: readPublic.getFingerprint()
  }
}

export async function getFingerprint(publicKeyArmored: string): Promise<string> {
  const key = await openpgp.readKey({ armoredKey: publicKeyArmored })
  return key.getFingerprint()
}

/**
 * Expiry and revocation, read from the key itself.
 *
 * Both are recorded inside the key, so the stored armor is the source rather than a column
 * that could drift from it. A key that cannot be parsed is reported as unremarkable instead
 * of as broken: the alternative is a red warning on every row when a library version changes.
 */
export async function keyFactsFrom(publicKeyArmored: string): Promise<KeyFacts> {
  try {
    const key = await openpgp.readKey({ armoredKey: publicKeyArmored })
    const expiry = await key.getExpirationTime()
    return {
      // openpgp returns Infinity for keys that never expire.
      expiresAt: expiry instanceof Date ? expiry.toISOString() : null,
      revoked: await key.isRevoked()
    }
  } catch {
    return { expiresAt: null, revoked: false }
  }
}

/** WKD serves binary keys while keyservers serve ASCII armor. Normalize either to armor. */
export async function normalizeDiscoveredKey(
  material: Buffer
): Promise<{ publicKeyArmored: string; fingerprint: string }> {
  const asText = material.toString('utf8')
  const key = asText.includes('BEGIN PGP PUBLIC KEY BLOCK')
    ? await openpgp.readKey({ armoredKey: asText })
    : await openpgp.readKey({ binaryKey: new Uint8Array(material) })

  return { publicKeyArmored: key.armor(), fingerprint: key.getFingerprint() }
}

export type UnlockFailure = 'wrongPassphrase' | 'passphraseRequired' | 'notPrivate' | 'unreadable'

export type UnlockResult =
  | { ok: true; key: openpgp.PrivateKey }
  | { ok: false; reason: UnlockFailure }

/**
 * Opens a private key so it can be stored ready to use.
 *
 * The key is kept unlocked afterwards, protected by this profile's own storage rather than by
 * the passphrase it arrived with. Keeping it sealed would mean asking for that passphrase
 * again on every signature and every encrypted message that arrives. And a prompt that
 * frequent is one people switch the feature off to escape.
 *
 * The failure reasons are kept apart because they call for different things from the user: a
 * wrong passphrase is worth typing again, a damaged file never will be.
 */
export async function unlockPrivateKey(
  key: openpgp.PrivateKey,
  passphrase: string
): Promise<UnlockResult> {
  if (key.isDecrypted()) return { ok: true, key }
  if (passphrase === '') return { ok: false, reason: 'passphraseRequired' }
  try {
    return { ok: true, key: await openpgp.decryptKey({ privateKey: key, passphrase }) }
  } catch {
    return { ok: false, reason: 'wrongPassphrase' }
  }
}

/** Accepts an armored *private* key and derives the matching public key from it. */
export async function importKeyPair(
  privateKeyArmored: string,
  passphrase = ''
): Promise<GeneratedKeyPair> {
  const sealed = await openpgp.readPrivateKey({ armoredKey: privateKeyArmored })
  const unlocked = await unlockPrivateKey(sealed, passphrase)
  if (!unlocked.ok) throw new Error(unlocked.reason)

  return {
    publicKeyArmored: unlocked.key.toPublic().armor(),
    privateKeyArmored: unlocked.key.armor(),
    fingerprint: unlocked.key.getFingerprint()
  }
}

/**
 * Encrypts a complete MIME entity for PGP/MIME (RFC 3156).
 *
 * Unlike the inline form this keeps the message intact: HTML stays HTML and attachments are
 * encrypted along with it, because the whole entity, not just some text, is the payload.
 */
export async function encryptMimeEntity(
  entity: string,
  recipientPublicKeysArmored: string[],
  senderPrivateKeyArmored: string | null
): Promise<string> {
  const encryptionKeys = await Promise.all(
    recipientPublicKeysArmored.map((armored) => openpgp.readKey({ armoredKey: armored }))
  )
  const signingKeys = senderPrivateKeyArmored
    ? await openpgp.readPrivateKey({ armoredKey: senderPrivateKeyArmored })
    : undefined

  const encrypted = await openpgp.encrypt({
    message: await openpgp.createMessage({ text: entity }),
    encryptionKeys,
    signingKeys
  })
  return encrypted as string
}

/** Detached signature over a MIME entity, for the second part of a multipart/signed message. */
export async function signMimeEntity(
  entity: string,
  senderPrivateKeyArmored: string
): Promise<string> {
  const signature = await openpgp.sign({
    message: await openpgp.createMessage({ text: entity }),
    signingKeys: await openpgp.readPrivateKey({ armoredKey: senderPrivateKeyArmored }),
    detached: true
  })
  return signature as string
}

export type SignatureCheck = 'valid' | 'invalid' | 'unknown'

/**
 * Checks a detached signature against the entity it was made over.
 *
 * `unknown` is not a weaker `invalid`: without the sender's public key nothing can be said
 * about the signature at all, and claiming otherwise in either direction would be a lie.
 */
/**
 * Whether any of the given signatures checked out.
 *
 * With several verification keys openpgp reports one result per key, and all but one of them
 * fail by design. The message was signed with a single key. One success is the answer.
 */
async function anyVerified(
  signatures: { verified: Promise<boolean> }[]
): Promise<boolean> {
  for (const signature of signatures) {
    try {
      await signature.verified
      return true
    } catch {
      // This key did not make the signature; the next one may have.
    }
  }
  return false
}

export async function verifyDetachedSignature(
  entity: string,
  armoredSignature: string,
  senderPublicKeysArmored: string[]
): Promise<SignatureCheck> {
  if (senderPublicKeysArmored.length === 0) return 'unknown'
  try {
    const result = await openpgp.verify({
      message: await openpgp.createMessage({ text: entity }),
      signature: await openpgp.readSignature({ armoredSignature }),
      verificationKeys: await Promise.all(
        senderPublicKeysArmored.map((armoredKey) => openpgp.readKey({ armoredKey }))
      )
    })
    return (await anyVerified(result.signatures)) ? 'valid' : 'invalid'
  } catch {
    return 'invalid'
  }
}

export interface CleartextResult {
  plaintext: string
  signature: SignatureCheck
}

/** Reads the inline form (`BEGIN PGP SIGNED MESSAGE`) that older clients still send. */
export async function verifyCleartextMessage(
  armored: string,
  senderPublicKeysArmored: string[]
): Promise<CleartextResult> {
  const message = await openpgp.readCleartextMessage({ cleartextMessage: armored })
  if (senderPublicKeysArmored.length === 0) {
    return { plaintext: message.getText(), signature: 'unknown' }
  }
  try {
    const result = await openpgp.verify({
      message,
      verificationKeys: await Promise.all(
        senderPublicKeysArmored.map((armoredKey) => openpgp.readKey({ armoredKey }))
      )
    })
    const valid = await anyVerified(result.signatures)
    return { plaintext: message.getText(), signature: valid ? 'valid' : 'invalid' }
  } catch {
    return { plaintext: message.getText(), signature: 'invalid' }
  }
}

export interface DecryptResult {
  plaintext: string
  signatureValid: boolean | null
}

/**
 * Opens an encrypted message with whichever of the recipient's keys fits.
 *
 * Every private key the account holds is offered, not just the current one. Mail encrypted
 * before a key rotation is encrypted to the old key and stays that way. Handing over only
 * the active key would make the archive unreadable the day a key is replaced.
 */
export async function decryptAndVerify(
  armoredMessage: string,
  recipientPrivateKeysArmored: string[],
  senderPublicKeysArmored: string[]
): Promise<DecryptResult> {
  const message = await openpgp.readMessage({ armoredMessage })
  const decryptionKeys = await Promise.all(
    recipientPrivateKeysArmored.map((armoredKey) => openpgp.readPrivateKey({ armoredKey }))
  )
  const verificationKeys =
    senderPublicKeysArmored.length > 0
      ? await Promise.all(
          senderPublicKeysArmored.map((armoredKey) => openpgp.readKey({ armoredKey }))
        )
      : undefined

  const result = await openpgp.decrypt({
    message,
    decryptionKeys,
    verificationKeys,
    expectSigned: false
  })

  let signatureValid: boolean | null = null
  if (verificationKeys && result.signatures.length > 0) {
    signatureValid = await anyVerified(result.signatures)
  }

  return { plaintext: result.data as string, signatureValid }
}

export const PGP_MESSAGE_MARKER = '-----BEGIN PGP MESSAGE-----'
