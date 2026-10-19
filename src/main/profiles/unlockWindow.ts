import { app, BrowserWindow, ipcMain } from 'electron'
import { windowBackground } from '../windowTheme'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { IpcChannels } from '@shared/ipcContracts'
import type { BetterSqliteDb } from '../db/sqlDb'
import type { ProfileSummary, ProfileUnlockResult } from '@peregrine/core/types'
import { openDb, closeDb } from '../db/db'
import {
  checkPassword,
  createProfile,
  deleteProfileRecord,
  deriveKey,
  migrateLegacyDatabase,
  profileDbPath,
  profilesRoot,
  readProfiles,
  type ProfileRecord
} from './profileStore'

/**
 * The gate in front of the application.
 *
 * Nothing else starts until a profile is open: no database, no IPC for mail, no account
 * connections. That ordering is the whole point. The server credentials live inside the
 * encrypted database, so before it is unlocked there is nothing to connect with.
 */

function toSummary(profile: ProfileRecord): ProfileSummary {
  return { id: profile.id, name: profile.name, encrypted: profile.encrypted }
}

export interface UnlockedProfile {
  profile: ProfileRecord
  /** Kept only in memory, for re-keying when the password is changed. */
  key: string | null
}

/**
 * Opens the chooser and resolves once a profile has been unlocked.
 *
 * Its IPC handlers are registered here and removed on close, so the unlock channels do not
 * stay reachable from the main window for the rest of the session.
 */
export function showUnlockWindow(): Promise<UnlockedProfile> {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 460,
      height: 560,
      resizable: false,
      show: false,
      backgroundColor: windowBackground(),
      autoHideMenuBar: true,
      title: 'Peregrine',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })

    let settled = false
    const channels = [
      IpcChannels.profilesList,
      IpcChannels.profilesUnlock,
      IpcChannels.profilesCreate,
      IpcChannels.profilesDelete
    ]
    const cleanup = (): void => {
      for (const channel of channels) ipcMain.removeHandler(channel)
    }

    ipcMain.handle(IpcChannels.profilesList, (): ProfileSummary[] => readProfiles().map(toSummary))

    ipcMain.handle(
      IpcChannels.profilesUnlock,
      (_event, args: { profileId: string; password: string }): ProfileUnlockResult => {
        const profile = readProfiles().find((p) => p.id === args.profileId)
        if (!profile) return { ok: false, reason: 'notFound' }
        if (!checkPassword(profile, args.password)) return { ok: false, reason: 'wrongPassword' }

        const key = profile.encrypted ? deriveKey(args.password, profile.salt) : null
        try {
          openDb(profileDbPath(profile.id), key)
        } catch (err) {
          // The verifier already matched, so this is a damaged or foreign file, not a typo.
          closeDb()
          console.error('opening profile failed:', err instanceof Error ? err.message : err)
          return { ok: false, reason: 'openFailed' }
        }

        settled = true
        cleanup()
        win.close()
        resolve({ profile, key })
        return { ok: true }
      }
    )

    ipcMain.handle(
      IpcChannels.profilesCreate,
      (_event, args: { name: string; password: string }): ProfileSummary => {
        const profile = createProfile(args.name, args.password || null)
        // Created here so the file exists with its encryption in place from the first byte.
        // A database written unencrypted and encrypted afterwards leaves its early pages
        // recoverable on disk.
        const key = profile.encrypted ? deriveKey(args.password, profile.salt) : null
        openDb(profileDbPath(profile.id), key)
        closeDb()
        return toSummary(profile)
      }
    )

    ipcMain.handle(IpcChannels.profilesDelete, (_event, args: { profileId: string }): void => {
      deleteProfileRecord(args.profileId)
      rmSync(join(profilesRoot(), args.profileId), { recursive: true, force: true })
    })

    win.on('ready-to-show', () => win.show())
    win.on('closed', () => {
      if (settled) return
      // Closed without unlocking: there is no application to show, so this ends the run.
      cleanup()
      reject(new Error('cancelled'))
    })

    const hash = '#unlock'
    if (process.env['ELECTRON_RENDERER_URL']) {
      void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}${hash}`)
    } else {
      void win.loadFile(join(__dirname, '../renderer/index.html'), { hash })
    }
  })
}

export interface OpenProfile extends UnlockedProfile {
  db: BetterSqliteDb
}

/**
 * Set when the app restarts itself to switch profiles or after an auto-lock.
 *
 * Without it a single unencrypted profile would be reopened immediately, and "switch profile"
 * would look like it did nothing at all.
 */
const FORCE_CHOOSER_FLAG = '--choose-profile'

export function shouldForceChooser(): boolean {
  return process.argv.includes(FORCE_CHOOSER_FLAG)
}

/** Restarts into the profile chooser: every connection dropped, the database closed. */
export function relaunchIntoChooser(): void {
  const args = process.argv.slice(1).filter((arg) => arg !== FORCE_CHOOSER_FLAG)
  app.relaunch({ args: [...args, FORCE_CHOOSER_FLAG] })
  app.exit(0)
}

/**
 * Gets to an open database, asking only when there is something to ask.
 *
 * A single profile without a password goes straight through: a chooser with one entry and no
 * password field would be a step that decides nothing. As soon as there are several profiles,
 * one is encrypted, or the app was restarted to switch, the chooser appears.
 */
export async function unlockProfile(): Promise<OpenProfile> {
  const profiles = readProfiles()
  if (!shouldForceChooser() && profiles.length === 1 && !profiles[0].encrypted) {
    const db = openDb(profileDbPath(profiles[0].id), null)
    return { profile: profiles[0], key: null, db }
  }

  const unlocked = await showUnlockWindow()
  // showUnlockWindow only resolves once openDb has succeeded, so this returns that instance.
  return { ...unlocked, db: openDb(profileDbPath(unlocked.profile.id), unlocked.key) }
}

/**
 * Makes sure at least one profile exists.
 *
 * A pre-profiles database is carried over into a profile of its own rather than left behind;
 * an update that loses someone's accounts is not an update.
 */
export function ensureProfileExists(): void {
  if (migrateLegacyDatabase()) return
  if (readProfiles().length === 0) {
    const profile = createProfile('Standard', null)
    openDb(profileDbPath(profile.id), null)
    closeDb()
  }
}
