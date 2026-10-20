import type { SqlDb } from '@peregrine/core/sqlDb'
import { AccountSetup } from './AccountSetup'
import { ComposeController } from './ComposeController'
import { MessageController } from './MessageController'
import { Navigator } from './Navigator'
import { discardFailedActions, refreshQueueStatus } from './queueStatus'
import { createServices, type Platform, type Services } from './services'
import type { AppStore } from './store'

/**
 * The application without its screens: the services it is made of and the controllers that change
 * what is shown. The screens get the controllers and call them, and know nothing else about it.
 */
export class Application {
  readonly navigator: Navigator
  readonly messages: MessageController
  readonly compose: ComposeController
  readonly accounts: AccountSetup

  constructor(
    readonly services: Services,
    readonly store: AppStore
  ) {
    this.navigator = new Navigator(services, store)
    this.messages = new MessageController(services, store, this.navigator)
    this.compose = new ComposeController(services, store, this.navigator)
    this.accounts = new AccountSetup(services, store, this.navigator)
  }

  /** Starts the application: removes what was left behind, then shows the first screen. */
  async start(): Promise<void> {
    await this.services.sweepCopies()
    await this.navigator.start()
  }

  /** Gives up on the actions that failed too often, and with them the files they carried. */
  async discardFailedActions(): Promise<void> {
    await discardFailedActions(this.services, this.store)
    await this.services.sweepCopies()
  }

  /** Lets go of what is open: the queue's timer and every connection. */
  stop(): void {
    this.services.queue.stop()
    this.services.connections.dropAll()
  }
}

/** Builds the application on a database that is open, and wires what the services report into the store. */
export function createApplication(db: SqlDb, platform: Platform, store: AppStore): Application {
  const services: Services = createServices(db, platform, {
    connectionsChanged: (connectedIds) => store.setConnected(connectedIds),
    queueChanged: () => refreshQueueStatus(services, store)
  })
  return new Application(services, store)
}
