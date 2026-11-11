import { ImapClientSession } from '@peregrine/imap/session'
import type { Platform } from './app/services'
import { createBackupCipher, createBackupFolder, createContacts, createDeviceLock, createPrinter, createFiles, createNotifications, createPgp, createPush, createSyncSchedule, createTransport } from './native'
import { useNativeS2k } from './pgp/pgpService'
import { FetchUnsubscriber } from './unsubscriber'

/** What the application gets from this device: the network, the files, and the console to log to. */
export function createPlatform(): Platform {
  useNativeS2k(createPgp())
  return {
    async connectImap(login) {
      const session = new ImapClientSession(login, { transport: createTransport() })
      await session.connect()
      return session
    },
    makeTransport: () => createTransport(),
    files: createFiles(),
    deviceContacts: createContacts(),
    deviceLock: createDeviceLock(),
    printer: createPrinter(),
    // The two kinds of AbortSignal (the DOM's, which the types use, and the platform's) are the same object at run time.
    unsubscriber: new FetchUnsubscriber((url, init) => fetch(url, { ...init, signal: init.signal as unknown as RequestInit['signal'] })),
    backupCipher: createBackupCipher(),
    backupFolder: createBackupFolder(),
    notifications: createNotifications(),
    syncSchedule: createSyncSchedule(),
    push: createPush(),
    log: { warn: (message) => console.warn(message), error: (message) => console.error(message) }
  }
}
