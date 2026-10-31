import { addressesFromUserIds } from '@peregrine/core/keyImport'
import { decodeUtf8 } from '@peregrine/imap/utf8'
import type { Key, PrivateKey } from 'openpgp'
import { installNativeS2k, type NativeS2k } from './nativeS2k'
import { openpgp } from './openpgp'
import { t } from '../i18n'

/** A key pair, both halves as ASCII armor, the private one open. */
export interface KeyPair {
  publicKey: string
  privateKey: string
  fingerprint: string
}

/** A new key pair for an address. The kind the desktop makes, which every current program reads: elliptic curve, small and fast. */
export async function generateKeyPair(name: string, address: string): Promise<KeyPair> {
  const { privateKey, publicKey } = await openpgp.generateKey({
    type: 'ecc',
    curve: 'curve25519Legacy',
    userIDs: [{ name, email: address }],
    format: 'object'
  })
  return { publicKey: publicKey.armor(), privateKey: privateKey.armor(), fingerprint: publicKey.getFingerprint() }
}

/** What a key in a file is, as far as the user has to decide anything about it. */
export interface ScannedKey {
  fingerprint: string
  /** `Name <address>`, as the key says it. */
  userIds: string[]
  /** The addresses of the user IDs, in lower case. */
  addresses: string[]
  publicKey: string
  /** The private half as it was in the file, when the file has it. */
  privateKey?: string
  /** The private half is sealed with a passphrase. */
  locked: boolean
  /** When the key stops being valid, or null when it does not. */
  expiresAt: Date | null
  /** Where it was found, for a key that was looked up and not read from a file: said on its card. */
  foundBy?: string
}

/** The armored blocks of a text: a file with several keys is often several blocks one after the other, which OpenPGP reads one at a time. */
const armoredBlocks = (text: string): string[] =>
  text.match(/-----BEGIN PGP (?:PUBLIC|PRIVATE) KEY BLOCK-----[\s\S]*?-----END PGP (?:PUBLIC|PRIVATE) KEY BLOCK-----/g) ?? []

/** The keys that are in the text or the bytes, whichever form they are in. */
async function readAllKeys(material: string | Uint8Array): Promise<Key[]> {
  const text = typeof material === 'string' ? material : decodeUtf8(material.subarray(0, 64))
  if (!text.includes('-----BEGIN PGP')) {
    if (typeof material === 'string') throw new Error(t('Das ist kein PGP-Schlüssel.'))
    return openpgp.readKeys({ binaryKeys: material })
  }
  const whole = typeof material === 'string' ? material : decodeUtf8(material)
  const blocks = armoredBlocks(whole)
  if (blocks.length === 0) throw new Error(t('Das ist kein PGP-Schlüssel.'))
  return (await Promise.all(blocks.map((armoredKeys) => openpgp.readKeys({ armoredKeys })))).flat()
}

/**
 * The keys in a file or in text that was pasted, in either form. A key that comes twice, as the public half and with the
 * private one, is one key, with the private half.
 */
export async function scanKeys(material: string | Uint8Array): Promise<ScannedKey[]> {
  const keys = await readAllKeys(material)
  const found = new Map<string, ScannedKey>()
  for (const key of keys) {
    const fingerprint = key.getFingerprint()
    const expiry = await key.getExpirationTime()
    const scanned: ScannedKey = {
      fingerprint,
      userIds: key.getUserIDs(),
      addresses: addressesFromUserIds(key.getUserIDs()),
      publicKey: key.toPublic().armor(),
      privateKey: key.isPrivate() ? key.armor() : undefined,
      locked: key.isPrivate() && !(key as PrivateKey).isDecrypted(),
      expiresAt: expiry instanceof Date ? expiry : null
    }
    const before = found.get(fingerprint)
    // The copy that has the private half is the one that is kept.
    if (!before || (scanned.privateKey && !before.privateKey)) found.set(fingerprint, scanned)
  }
  return [...found.values()]
}

/** What a key is good for now. A key that cannot be read is good for nothing, and is not said to be broken for it. */
export interface KeyState {
  /** When it stops being valid, as an ISO time, or null when it does not. */
  expiresAt: string | null
  /** Withdrawn by its owner: the gravest state, and not a matter of time. */
  revoked: boolean
  canEncrypt: boolean
  canSign: boolean
}

/** Whether a key has expired or been withdrawn, and whether it can still encrypt and sign, read from the key itself. */
export async function keyState(armoredKey: string): Promise<KeyState> {
  try {
    const key = await openpgp.readKey({ armoredKey })
    const expiry = await key.getExpirationTime()
    const can = async (find: () => Promise<unknown>): Promise<boolean> => {
      try {
        await find()
        return true
      } catch {
        return false
      }
    }
    return {
      // OpenPGP gives Infinity for a key that does not expire.
      expiresAt: expiry instanceof Date ? expiry.toISOString() : null,
      revoked: await key.isRevoked(),
      canEncrypt: await can(() => key.getEncryptionKey()),
      canSign: await can(() => key.getSigningKey())
    }
  } catch {
    return { expiresAt: null, revoked: false, canEncrypt: false, canSign: false }
  }
}

/** The hashing of the platform, where there is one, which opening a sealed key then uses. */
let platformHash: NativeS2k | undefined

/** Gives the platform's hashing to what opens a sealed key. Called once, where the application starts. */
export function useNativeS2k(hash: NativeS2k | undefined): void {
  platformHash = hash
}

export type UnlockResult = { ok: true; privateKey: string } | { ok: false; reason: 'wrongPassphrase' | 'passphraseRequired' }

/**
 * Opens a private key that is sealed. Done once, when the key is taken in, and the key is kept open after that, as the
 * desktop does it: a key that stayed sealed would ask for its passphrase at every message that is read or signed.
 *
 * It takes long where the hashing is left to a script: a key from a mail program is sealed so that opening it needs tens of
 * millions of bytes hashed. The platform does that where it has been given (`useNativeS2k`), in a moment; the callers say so
 * where it has not.
 */
export async function unlockKey(armoredPrivateKey: string, passphrase: string): Promise<UnlockResult> {
  const key = await openpgp.readPrivateKey({ armoredKey: armoredPrivateKey })
  if (key.isDecrypted()) return { ok: true, privateKey: key.armor() }
  if (platformHash) installNativeS2k(key, platformHash)
  if (passphrase === '') return { ok: false, reason: 'passphraseRequired' }
  try {
    return { ok: true, privateKey: (await openpgp.decryptKey({ privateKey: key, passphrase })).armor() }
  } catch {
    return { ok: false, reason: 'wrongPassphrase' }
  }
}

/** Whether any of the signatures of a result checked out. With several keys to try, all but the one that signed fail by design. */
async function anyVerified(signatures: { verified: Promise<boolean> }[]): Promise<boolean> {
  for (const signature of signatures) {
    try {
      await signature.verified
      return true
    } catch {
      // This key did not make the signature; the next may have.
    }
  }
  return false
}

const readPublicKeys = (armored: string[]) => Promise.all(armored.map((armoredKey) => openpgp.readKey({ armoredKey })))

/**
 * A MIME entity encrypted to the keys given, and signed when a private key is given: the armored message. The sender's
 * own public key is among the recipients, which the caller sees to, so that the message stays readable in the Sent folder.
 */
export async function encryptEntity(entity: string, recipientPublicKeys: string[], signWith?: string): Promise<string> {
  const encrypted = await openpgp.encrypt({
    message: await openpgp.createMessage({ text: entity }),
    encryptionKeys: await readPublicKeys(recipientPublicKeys),
    signingKeys: signWith ? await openpgp.readPrivateKey({ armoredKey: signWith }) : undefined
  })
  return encrypted as string
}

/** The detached signature, as armor, of a MIME entity. */
export async function signEntity(entity: string, privateKey: string): Promise<string> {
  const signature = await openpgp.sign({
    message: await openpgp.createMessage({ text: entity }),
    signingKeys: await openpgp.readPrivateKey({ armoredKey: privateKey }),
    detached: true
  })
  return signature as string
}

/**
 * What can be said of a signature. `unknown` is not a weaker `invalid`: without the sender's key nothing can be said of it,
 * and to claim anything either way would be a lie.
 */
export type SignatureCheck = 'valid' | 'invalid' | 'unknown'

/** Checks a detached signature against the entity it was made over, with every key held for the sender. */
export async function verifyDetached(entity: string, armoredSignature: string, senderKeys: string[]): Promise<SignatureCheck> {
  if (senderKeys.length === 0) return 'unknown'
  try {
    const result = await openpgp.verify({
      message: await openpgp.createMessage({ text: entity }),
      signature: await openpgp.readSignature({ armoredSignature }),
      verificationKeys: await readPublicKeys(senderKeys)
    })
    return (await anyVerified(result.signatures)) ? 'valid' : 'invalid'
  } catch {
    return 'invalid'
  }
}

/** The inline form, `BEGIN PGP SIGNED MESSAGE`, which older programs still send. */
export async function verifyCleartext(armored: string, senderKeys: string[]): Promise<{ text: string; signature: SignatureCheck }> {
  const message = await openpgp.readCleartextMessage({ cleartextMessage: armored })
  const text = message.getText()
  if (senderKeys.length === 0) return { text, signature: 'unknown' }
  try {
    const result = await openpgp.verify({ message, verificationKeys: await readPublicKeys(senderKeys) })
    return { text, signature: (await anyVerified(result.signatures)) ? 'valid' : 'invalid' }
  } catch {
    return { text, signature: 'invalid' }
  }
}

export interface Decrypted {
  text: string
  /** Whether the message was signed and the signature is the sender's; null when it was not signed or no key of the sender is held. */
  signed: boolean | null
}

/**
 * Opens an encrypted message with whichever of the account's keys fits, every one of them offered: mail from before a key
 * was replaced is encrypted to the old one. Throws when none fits.
 */
export async function decryptMessage(armoredMessage: string, privateKeys: string[], senderKeys: string[]): Promise<Decrypted> {
  const verificationKeys = senderKeys.length > 0 ? await readPublicKeys(senderKeys) : undefined
  const result = await openpgp.decrypt({
    message: await openpgp.readMessage({ armoredMessage }),
    decryptionKeys: await Promise.all(privateKeys.map((armoredKey) => openpgp.readPrivateKey({ armoredKey }))),
    verificationKeys,
    expectSigned: false
  })
  const signed = verificationKeys && result.signatures.length > 0 ? await anyVerified(result.signatures) : null
  // OpenPGP gives text with the line ends of the platform. A message, whose parts the readers split at CR LF, has those.
  return { text: (result.data as string).replace(/\r?\n/g, '\r\n'), signed }
}
