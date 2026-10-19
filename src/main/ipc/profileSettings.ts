import type { BetterSqliteDb } from '../db/sqlDb'
import type { IpcMain } from 'electron'
import { IpcChannels } from '@shared/ipcContracts'
import type { ProfileSummary } from '@peregrine/core/types'
import { rekeyDb } from '../db/db'
import {
  checkPassword,
  createProfile,
  deriveKey,
  readProfiles,
  renameProfile,
  setProfilePassword
} from '../profiles/profileStore'
import { relaunchIntoChooser } from '../profiles/unlockWindow'

/**
 * Managing the profile that is currently open.
 *
 * Setting a password after the fact re-encrypts the database in place. It has to happen on
 * the live connection: `PRAGMA rekey` rewrites every page with the new key, and doing that on
 * a second connection while this one holds the file open is how a database gets corrupted.
 */
export function registerProfileSettingsIpc(
  ipcMain: IpcMain,
  db: BetterSqliteDb,
  profileId: string,
  /** Updated in place when the password changes, so a later change starts from the right key. */
  currentKey: { value: string | null }
): void {
  ipcMain.handle(IpcChannels.profileCurrent, (): ProfileSummary | null => {
    const profile = readProfiles().find((p) => p.id === profileId)
    return profile ? { id: profile.id, name: profile.name, encrypted: profile.encrypted } : null
  })

  ipcMain.handle(IpcChannels.profileRename, (_event, args: { name: string }): void => {
    renameProfile(profileId, args.name)
  })

  ipcMain.handle(IpcChannels.profileList, (): ProfileSummary[] =>
    readProfiles().map((p) => ({ id: p.id, name: p.name, encrypted: p.encrypted }))
  )

  /**
   * Creates a further profile without leaving the one that is open.
   *
   * Until now this was only possible in the chooser at startup, which meant quitting the
   * application to make a second mailbox for someone else. Creating one here writes the entry
   * and its directory; the database inside it is built the first time it is unlocked, by the
   * same code that opens every other profile.
   *
   * Switching is deliberately a separate step, and it restarts. The same reason locking
   * does: every handler here holds this profile's database and the account manager holds live
   * sockets against it.
   */
  ipcMain.handle(
    IpcChannels.profileCreate,
    (_event, args: { name: string; password: string }): ProfileSummary | { error: 'nameTaken' } => {
      const name = args.name.trim()
      if (!name) return { error: 'nameTaken' }
      // Two profiles with the same name are indistinguishable in the chooser, which is the
      // one place where picking the wrong one costs the most.
      if (readProfiles().some((p) => p.name.toLowerCase() === name.toLowerCase())) {
        return { error: 'nameTaken' }
      }
      const created = createProfile(name, args.password || null)
      return { id: created.id, name: created.name, encrypted: created.encrypted }
    }
  )

  /**
   * Locking restarts the app rather than tearing the session down in place.
   *
   * Every IPC handler here closes over this profile's database, and the account manager holds
   * live IMAP sockets against it. Unwinding all of that correctly and rebuilding it for the
   * next profile is a lot of moving parts for something a restart does exactly right. And a
   * restart also guarantees the old key is gone from memory.
   */
  ipcMain.handle(IpcChannels.profileLock, (): void => {
    relaunchIntoChooser()
  })

  ipcMain.handle(
    IpcChannels.profileSetPassword,
    async (
      _event,
      args: { currentPassword: string; newPassword: string }
    ): Promise<{ ok: boolean; reason?: 'wrongPassword' }> => {
      const profile = readProfiles().find((p) => p.id === profileId)
      if (!profile) return { ok: false }

      // Knowing the current password is required even though the database is already open:
      // otherwise anyone at an unlocked screen could lock the owner out of their own profile.
      if (!checkPassword(profile, args.currentPassword)) {
        return { ok: false, reason: 'wrongPassword' }
      }

      const password = args.newPassword === '' ? null : args.newPassword
      const newKey = password ? deriveKey(password, profile.salt) : null

      await rekeyDb(db, newKey)
      setProfilePassword(profileId, password)
      currentKey.value = newKey
      return { ok: true }
    }
  )
}
