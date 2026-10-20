import type { ImapSession } from '@peregrine/core/imapSession'
import type { QueueRunner } from '@peregrine/core/offlineQueue'
import type { SqlDb } from '@peregrine/core/sqlDb'
import type { Transport } from '@peregrine/imap/transport'
import { sweepCopies } from '../attachmentCopies'
import { Connections } from '../connections'
import { describeError } from '../errors'
import type { Files } from '../files'
import { MailActions } from '../mailActions'
import { createQueue } from '../queue'
import { sendAndFile } from '../send'
import { imapLoginOf, type ImapLogin } from './accountForm'

/** Where the application writes down what it cannot show anybody. */
export interface Log {
  warn(message: string): void
  error(message: string): void
}

/** What the application gets from the device: the network, the files, and a place to log to. */
export interface Platform {
  connectImap(login: ImapLogin): Promise<ImapSession>
  makeTransport(): Transport
  files: Files
  log: Log
}

/** What the application is made of, apart from its screens. */
export interface Services {
  db: SqlDb
  connections: Connections
  queue: QueueRunner
  mail: MailActions
  files: Files
  log: Log
  /** A connection that belongs to no account yet, to find out whether a login works. */
  connectImap(login: ImapLogin): Promise<ImapSession>
  /**
   * Removes the copies of attached files that no queued message refers to. What cannot be removed is
   * logged and not raised: a copy that is left is a leak of storage and no reason to stop anything.
   */
  sweepCopies(): Promise<void>
}

export interface ServiceListeners {
  /** Called with the accounts that are connected whenever one is gained or lost. */
  connectionsChanged(connectedIds: string[]): void
  /** Called whenever something changed about what waits in the queue. */
  queueChanged(): Promise<void>
}

/**
 * Puts the services together: the connections of the accounts, the queue that replays what was decided
 * and sends what was written, and the actions the screens ask for, which go through the queue.
 */
export function createServices(db: SqlDb, platform: Platform, listeners: ServiceListeners): Services {
  const { log, files } = platform
  const connections = new Connections(
    (account) => platform.connectImap(imapLoginOf(account)),
    listeners.connectionsChanged
  )
  const queue = createQueue(db, { changed: listeners.queueChanged, log })
  queue.setSendHandler((input, imap) =>
    sendAndFile(db, { makeTransport: () => platform.makeTransport(), files }, input, imap, log)
  )
  const mail = new MailActions({ db, queue, session: (accountId) => connections.get(accountId), log })
  return {
    db,
    connections,
    queue,
    mail,
    files,
    log,
    connectImap: (login) => platform.connectImap(login),
    sweepCopies: async () => {
      try {
        await sweepCopies(db, files)
      } catch (error) {
        log.error(`removing the leftover copies of attached files failed: ${describeError(error)}`)
      }
    }
  }
}
