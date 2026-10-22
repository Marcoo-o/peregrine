import type { SqlDb } from '@peregrine/core/sqlDb'
import { AccountSetup } from './AccountSetup'
import { describeError } from '../errors'
import { ComposeController } from './ComposeController'
import { MessageController } from './MessageController'
import { Navigator } from './Navigator'
import { discardFailedActions, refreshQueueStatus } from './queueStatus'
import { SelectionController } from './SelectionController'
import { createServices, type Platform, type Services } from './services'
import { SettingsController } from './SettingsController'
import { TagController } from './TagController'
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
  readonly settings: SettingsController
  readonly selection: SelectionController
  readonly tags: TagController

  constructor(
    readonly services: Services,
    readonly store: AppStore
  ) {
    this.navigator = new Navigator(services, store)
    this.messages = new MessageController(services, store, this.navigator)
    this.compose = new ComposeController(services, store, this.navigator)
    this.accounts = new AccountSetup(services, store, this.navigator)
    this.settings = new SettingsController(services, store, this.navigator)
    this.selection = new SelectionController(services, store, this.navigator)
    this.tags = new TagController(services, store)
  }

  /**
   * Starts the application: removes what was left behind, makes the platform's schedule for looking for new
   * mail what the settings say, shows the first screen, and opens the message a notification was tapped for
   * when it is that which started the application.
   */
  async start(): Promise<void> {
    await this.services.sweepCopies()
    await this.settings.applySchedule()
    await this.tags.load()
    await this.navigator.start()
    await this.openLaunchTarget()
  }

  /**
   * Opens the message a notification was tapped for, which the platform keeps until it is asked. Called at
   * the start and whenever the application comes to the front, where a tap on a notification arrives when
   * it is running already.
   */
  async openLaunchTarget(): Promise<void> {
    try {
      const target = await this.services.notifications.consumeLaunchTarget()
      if (target) await this.messages.openTarget(target)
    } catch (error) {
      this.services.log.error(`the message of a notification could not be opened: ${describeError(error)}`)
    }
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
