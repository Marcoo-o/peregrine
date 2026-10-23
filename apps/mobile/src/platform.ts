import { ImapClientSession } from '@peregrine/imap/session'
import type { Platform } from './app/services'
import { createFiles, createNotifications, createPush, createSyncSchedule, createTransport } from './native'

/** What the application gets from this device: the network, the files, and the console to log to. */
export function createPlatform(): Platform {
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
