import { app } from 'electron'
import { randomBytes } from 'node:crypto'
import { deriveKey, deriveVerifier, newSalt, verifierMatches } from './profileCrypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Profiles, each with its own encrypted database.
 *
 * The password is not a lock on the window: it derives the key the database itself is
 * encrypted with. Without it the file is unreadable, so the app cannot reach the stored
 * server credentials and therefore cannot connect to anything. A lock that only hid the
 * interface would leave both the mail and the credentials sitting in the open next to it.
 */

export interface ProfileRecord {
  id: string
  name: string
  /** Random per profile, so identical passwords in two profiles yield different keys. */
  salt: string
  /** No password set: the database is created unencrypted and opens without asking. */
  encrypted: boolean
  /**
   * Encrypted proof that a given password is the right one, so a wrong entry is reported as
   * such instead of surfacing as "file is not a database" from somewhere deep in a query.
   */
  verifier?: string
  createdAt: string
}

interface ProfilesFile {
  version: 1
  profiles: ProfileRecord[]
}

export function profilesRoot(): string {
  return join(app.getPath('userData'), 'profiles')
}

function profilesFilePath(): string {
  return join(app.getPath('userData'), 'profiles.json')
}

export function profileDbPath(profileId: string): string {
  return join(profilesRoot(), profileId, 'peregrine.db')
}

export function readProfiles(): ProfileRecord[] {
  try {
    const parsed = JSON.parse(readFileSync(profilesFilePath(), 'utf8')) as ProfilesFile
    return Array.isArray(parsed.profiles) ? parsed.profiles : []
  } catch {
    return []
  }
}

function writeProfiles(profiles: ProfileRecord[]): void {
  const file: ProfilesFile = { version: 1, profiles }
  writeFileSync(profilesFilePath(), JSON.stringify(file, null, 2))
}

export function checkPassword(profile: ProfileRecord, password: string): boolean {
  if (!profile.encrypted) return true
  if (!profile.verifier) return false
  return verifierMatches(profile.verifier, password, profile.salt)
}

export function createProfile(name: string, password: string | null): ProfileRecord {
  const id = randomBytes(8).toString('hex')
  const salt = newSalt()
  const profile: ProfileRecord = {
    id,
    name,
    salt,
    encrypted: password != null && password !== '',
    verifier: password ? deriveVerifier(password, salt) : undefined,
    createdAt: new Date().toISOString()
  }

  mkdirSync(join(profilesRoot(), id), { recursive: true })
  writeProfiles([...readProfiles(), profile])
  return profile
}

export function renameProfile(profileId: string, name: string): void {
  writeProfiles(readProfiles().map((p) => (p.id === profileId ? { ...p, name } : p)))
}

/** Records a changed password. The database itself is re-keyed separately, by the caller. */
export function setProfilePassword(profileId: string, password: string | null): ProfileRecord | null {
  const profiles = readProfiles()
  const profile = profiles.find((p) => p.id === profileId)
  if (!profile) return null

  const updated: ProfileRecord = {
    ...profile,
    encrypted: password != null && password !== '',
    verifier: password ? deriveVerifier(password, profile.salt) : undefined
  }
  writeProfiles(profiles.map((p) => (p.id === profileId ? updated : p)))
  return updated
}

export function deleteProfileRecord(profileId: string): void {
  writeProfiles(readProfiles().filter((p) => p.id !== profileId))
}

/**
 * Moves a pre-profiles database into a profile of its own.
 *
 * Runs once, on the first start after profiles were introduced. The file is *moved*, never
 * copied and never recreated: an upgrade that leaves someone's accounts behind is worse than
 * one that fails outright, and a copy would leave a second unencrypted database on disk.
 */
export function migrateLegacyDatabase(): ProfileRecord | null {
  const legacy = join(app.getPath('userData'), 'peregrine.db')
  if (!existsSync(legacy)) return null
  if (readProfiles().length > 0) return null

  const profile = createProfile('Standard', null)
  const target = profileDbPath(profile.id)
  renameSync(legacy, target)

  // WAL and shared-memory files belong to the database and have to travel with it.
  for (const suffix of ['-wal', '-shm']) {
    if (existsSync(legacy + suffix)) renameSync(legacy + suffix, target + suffix)
  }
  return profile
}

// Re-exported so callers need only one profile module.
export { deriveKey }
