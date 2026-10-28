import { ImapClientSession } from '@peregrine/imap/session'
import type { Platform } from './app/services'
import { createFiles, createNotifications, createPgp, createPush, createSyncSchedule, createTransport } from './native'
import { useNativeS2k } from './pgp/pgpService'

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
    notifications: createNotifications(),
    syncSchedule: createSyncSchedule(),
    push: createPush(),
    log: { warn: (message) => console.warn(message), error: (message) => console.error(message) }
  }
}
