import type { SqlDb } from '../db/sqlDb'
import { readFileSync } from 'node:fs'
import * as openpgp from 'openpgp'
import { assignKeys, isImportable, type KeyAssignment, type ScannedKey } from '@peregrine/core/keyImport'
import type { KeyImportResult, KeyImportSource } from '@peregrine/core/types'
import {
  describeKey,
  readKeyMaterial,
  thunderbirdKeyringPaths
} from '../import/thunderbirdKeys'
import { listAccounts } from '../db/repositories/accountsRepo'
import { upsertContactFromMail } from '../db/repositories/contactsRepo'
import {
  getContactIdByEmail,
  listAccountKeyFingerprints,
  listContactKeyFingerprints,
  saveAccountPgpKey,
  saveContactPgpKey
} from '../db/repositories/pgpKeysRepo'
import { unlockPrivateKey } from './pgpService'

/**
 * Taking a whole set of keys over at once.
 *
 * Peregrine's key handling was built one account at a time: paste an armored key, pick the
 * account, repeat. That is fine for one identity and unbearable for twelve, which is exactly
 * the shape a Thunderbird user arrives in. Here the addresses in a key's user IDs do the
 * filing, and the user confirms the result rather than assembling it.
 *
 * The mapping is recomputed here from the database rather than taken from the renderer. The
 * window sends which keys to take, never where to put them. A private key landing on the
 * wrong account is not something a message from a window should be able to arrange.
 */

interface LoadedSource {
  /** Where the keys came from, for the user to recognise. A profile or a file path. */
  origin: string | null
  keys: openpgp.Key[]
}

async function loadSource(source: KeyImportSource): Promise<LoadedSource> {
  const paths =
    source.kind === 'file'
      ? { origin: source.path, paths: [source.path] }
      : (() => {
          const found = thunderbirdKeyringPaths(source.profilePath)
          return { origin: found.profilePath, paths: found.paths }
        })()

  const keys: openpgp.Key[] = []
  for (const path of paths.paths) {
    try {
      keys.push(...(await readKeyMaterial(readFileSync(path))))
    } catch (err) {
      // One unreadable ring must not cost the other: a damaged secring still leaves every
      // public key importable. A single chosen file failing is reported by the empty result.
      console.error(`reading ${path} failed:`, err instanceof Error ? err.message : err)
    }
  }
  return { origin: paths.origin, keys }
}

/**
 * Collapses a key that appears more than once into one entry.
 *
 * Almost every key of one's own turns up twice. The public ring holds it, the secret ring
 * holds it with its private half. And an exported file does the same. Keeping both would
 * show the user each of their keys twice, once as useless.
 */
function mergeByFingerprint(keys: ScannedKey[]): ScannedKey[] {
  const byFingerprint = new Map<string, ScannedKey>()
  for (const key of keys) {
    const existing = byFingerprint.get(key.fingerprint)
    byFingerprint.set(
      key.fingerprint,
      existing
        ? {
            ...existing,
            hasPrivate: existing.hasPrivate || key.hasPrivate,
            privateUnlocked: existing.privateUnlocked || key.privateUnlocked,
            userIds: [...new Set([...existing.userIds, ...key.userIds])],
            addresses: [...new Set([...existing.addresses, ...key.addresses])]
          }
        : key
    )
  }
  return [...byFingerprint.values()]
}

export interface KeyScan {
  origin: string | null
  assignments: KeyAssignment[]
}

async function assign(
  db: SqlDb,
  keys: ScannedKey[],
  source: KeyImportSource
): Promise<KeyAssignment[]> {
  const accounts = (await listAccounts(db)).map((a) => ({
    id: a.id,
    emailAddress: a.emailAddress
  }))
  return assignKeys(keys, accounts, {
    knownFingerprints: await knownFingerprints(db),
    // Thunderbird's own passphrase is never shown to the user, so it cannot be asked for.
    passphraseAvailable: source.kind === 'file'
  })
}

async function knownFingerprints(db: SqlDb): Promise<string[]> {
  return [
    ...(await listAccountKeyFingerprints(db)),
    ...Object.values(await listContactKeyFingerprints(db))
  ]
}

export async function scanKeySource(db: SqlDb, source: KeyImportSource): Promise<KeyScan> {
  const loaded = await loadSource(source)
  const described = mergeByFingerprint(await Promise.all(loaded.keys.map(describeKey)))
  return { origin: loaded.origin, assignments: await assign(db, described, source) }
}

export async function importKeys(
  db: SqlDb,
  source: KeyImportSource,
  fingerprints: string[],
  passphrase: string
): Promise<KeyImportResult[]> {
  const wanted = new Set(fingerprints.map((f) => f.toLowerCase()))
  const loaded = await loadSource(source)
  const described = mergeByFingerprint(await Promise.all(loaded.keys.map(describeKey)))
  const byFingerprint = new Map(
    (await assign(db, described, source)).map((a) => [a.key.fingerprint.toLowerCase(), a])
  )

  // Oldest first, so that when several keys belong to one account the newest is written last
  // and ends up the active one. The private half goes after the public one of the same age:
  // it is the half worth having, and the later write wins.
  const ordered = [...loaded.keys].sort((a, b) => {
    const byAge = a.getCreationTime().getTime() - b.getCreationTime().getTime()
    return byAge !== 0 ? byAge : Number(a.isPrivate()) - Number(b.isPrivate())
  })

  const results = new Map<string, KeyImportResult>()
  for (const key of ordered) {
    const fingerprint = key.getFingerprint()
    if (!wanted.has(fingerprint.toLowerCase())) continue

    // The same key arrives twice, public first. The private half is the one worth having, so
    // a later public entry must not undo a result already achieved with it.
    if (results.get(fingerprint)?.status === 'imported' && !key.isPrivate()) continue

    const assignment = byFingerprint.get(fingerprint.toLowerCase())
    results.set(
      fingerprint,
      assignment && isImportable(assignment)
        ? await importOne(db, key, assignment, passphrase)
        : { fingerprint, status: 'skipped', targets: [] }
    )
  }

  return [...results.values()]
}

async function importOne(
  db: SqlDb,
  key: openpgp.Key,
  assignment: KeyAssignment,
  passphrase: string
): Promise<KeyImportResult> {
  const fingerprint = key.getFingerprint()

  if (assignment.accountIds.length > 0) {
    // The merged description said this key has a private half; this particular entry may
    // still be the public one, in which case the secret entry follows and does the work.
    if (!key.isPrivate()) return { fingerprint, status: 'skipped', targets: [] }

    const unlocked = await unlockPrivateKey(key as openpgp.PrivateKey, passphrase)
    if (!unlocked.ok) return { fingerprint, status: 'failed', reason: unlocked.reason, targets: [] }

    const publicKeyArmored = unlocked.key.toPublic().armor()
    const privateKeyArmored = unlocked.key.armor()
    for (const accountId of assignment.accountIds) {
      await saveAccountPgpKey(db, accountId, publicKeyArmored, privateKeyArmored, fingerprint)
    }
    return { fingerprint, status: 'imported', targets: assignment.accountIds }
  }

  const address = assignment.contactAddress
  if (!address) return { fingerprint, status: 'skipped', targets: [] }

  // The contact is created on the way, as it is for a discovered key: a key needs somewhere
  // to live, and that place is a contact.
  await upsertContactFromMail(db, nameFromUserId(assignment.key.userIds[0] ?? ''), address)
  const contactId = await getContactIdByEmail(db, address)
  if (!contactId) return { fingerprint, status: 'failed', reason: 'unreadable', targets: [] }

  // 'manual' is the honest source: the key came from the user, not from WKD or a keyserver.
  await saveContactPgpKey(db, contactId, key.toPublic().armor(), fingerprint, { source: 'manual' })
  return { fingerprint, status: 'imported', targets: [address] }
}

function nameFromUserId(userId: string): string {
  return userId.replace(/\s*<[^>]*>\s*/, '').trim()
}
