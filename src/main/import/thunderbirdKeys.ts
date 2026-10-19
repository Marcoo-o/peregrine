import { existsSync } from 'node:fs'
import { join } from 'node:path'
import * as openpgp from 'openpgp'
import { addressesFromUserIds, type ScannedKey } from '@peregrine/core/keyImport'
import { findThunderbirdProfile } from './thunderbird'

/**
 * Locating and reading the OpenPGP keyrings of a Thunderbird profile.
 *
 * Thunderbird 78 and later keep keys in `pubring.gpg` and `secring.gpg` beside the profile,
 * plain OpenPGP packet streams, which openpgp.js reads directly. Read-only, like the account
 * import beside it: nothing here writes into a profile the user may still be using.
 *
 * The private halves come out sealed. Thunderbird protects them with a passphrase it generates
 * itself and keeps in its own password store, and that store is deliberately left alone. For
 * the same reason the account import asks for passwords rather than taking them. What comes
 * across without it are the public keys, which is usually the part that took years to collect.
 */

const KEYRINGS = ['pubring.gpg', 'secring.gpg'] as const

/** The rings that actually exist, in the order public-then-secret. Empty when there is no profile. */
export function thunderbirdKeyringPaths(explicitProfilePath?: string): {
  profilePath: string | null
  paths: string[]
} {
  const profilePath = explicitProfilePath ?? findThunderbirdProfile()
  if (!profilePath) return { profilePath: null, paths: [] }
  return {
    profilePath,
    paths: KEYRINGS.map((ring) => join(profilePath, ring)).filter((path) => existsSync(path))
  }
}

/** Each `BEGIN … END` block in an armored file, as its own string. */
const ARMOR_BLOCK = /-----BEGIN PGP [^-]+-----[\s\S]*?-----END PGP [^-]+-----/g

/**
 * Reads every key in one armored or binary blob.
 *
 * Armored files are split into their blocks first. `readKeys` stops after the first block, so
 * a file holding one block per key, which is what Thunderbird's "Backup Secret Keys" writes,
 * would otherwise come through as a single key and the rest would vanish without a word.
 */
export async function readKeyMaterial(material: Buffer): Promise<openpgp.Key[]> {
  const asText = material.toString('utf8')
  if (!asText.includes('-----BEGIN PGP')) {
    return openpgp.readKeys({ binaryKeys: new Uint8Array(material) })
  }

  const keys: openpgp.Key[] = []
  for (const block of asText.match(ARMOR_BLOCK) ?? []) {
    try {
      keys.push(...(await openpgp.readKeys({ armoredKeys: block })))
    } catch (err) {
      // One malformed block must not cost the rest of the file.
      console.error('reading a key block failed:', err instanceof Error ? err.message : err)
    }
  }
  return keys
}

export async function describeKey(key: openpgp.Key): Promise<ScannedKey> {
  const userIds = key.getUserIDs()
  let expiresAt: string | null = null
  try {
    const expiry = await key.getExpirationTime()
    // openpgp returns Infinity for keys that never expire.
    if (expiry instanceof Date) expiresAt = expiry.toISOString()
  } catch {
    // A key whose expiry cannot be read is still a key; treat it as non-expiring rather than
    // dropping it, and let the user decide.
  }

  const isPrivate = key.isPrivate()
  return {
    fingerprint: key.getFingerprint(),
    userIds,
    addresses: addressesFromUserIds(userIds),
    hasPrivate: isPrivate,
    privateUnlocked: isPrivate ? isUnlocked(key) : false,
    createdAt: key.getCreationTime().toISOString(),
    expiresAt
  }
}

function isUnlocked(key: openpgp.Key): boolean {
  try {
    return (key as openpgp.PrivateKey).isDecrypted()
  } catch {
    return false
  }
}
