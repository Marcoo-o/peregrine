import type { SqlDb } from '@peregrine/core/sqlDb'
import { AccountSetup } from './AccountSetup'
import { describeError } from '../errors'
import { ComposeController } from './ComposeController'
import { ProtectionDefaults } from '../pgp/protectionDefaults'
import { FolderController } from './FolderController'
import { KeysController } from './KeysController'
import { MessageController } from './MessageController'
import { Navigator } from './Navigator'
import { discardFailedActions, refreshQueueStatus } from './queueStatus'
import { accountsNeedingConnection, connectAndRun, Reconnector, type ReconnectTimers } from './Reconnector'
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
  readonly folders: FolderController
  readonly settings: SettingsController
  readonly selection: SelectionController
  readonly tags: TagController
  readonly keys: KeysController
  /** What a new message starts with, which the screen for keys sets and the screen for writing asks. */
  readonly protection: ProtectionDefaults

  constructor(
    readonly services: Services,
    readonly store: AppStore,
    private readonly reconnector: Reconnector
  ) {
    this.navigator = new Navigator(services, store)
    this.messages = new MessageController(services, store, this.navigator)
    this.protection = new ProtectionDefaults(services.db)
    this.compose = new ComposeController(services, store, this.navigator, this.protection)
    this.accounts = new AccountSetup(services, store, this.navigator)
    this.settings = new SettingsController(services, store, this.navigator)
    this.selection = new SelectionController(services, store, this.navigator)
    this.tags = new TagController(services, store)
    this.keys = new KeysController(services, store, this.protection)
    this.folders = new FolderController(services, store, this.navigator)
  }

  /**
   * Starts the application: removes what was left behind, makes the platform's schedule for looking for new
   * mail what the settings say, shows the first screen, and opens the message a notification was tapped for
   * when it is that which started the application.
   */
  async start(): Promise<void> {
    await this.services.sweepCopies()
    await this.settings.applySchedule()
    await this.settings.applyPush()
    await this.tags.load()
    await this.protection.load()
    await this.navigator.start()
    await this.openLaunchTarget()
    await this.openIncoming()
  }

  /**
   * Starts the message that another application asked for, a link to an address or something shared with this one. Asked at
   * the start and whenever the application comes to the front, where such a request arrives when it is running already.
   */
  async openIncoming(): Promise<void> {
    try {
      // Not over a message that is being written: what was typed so far is on the screen and nowhere else. The request waits for the next time.
      if (this.store.screen.name === 'compose') return
      const incoming = await this.services.files.consumeIncoming()
      if (incoming) await this.compose.startFromIncoming(incoming)
    } catch (error) {
      this.services.log.error(`what another application shared could not be opened: ${describeError(error)}`)
    }
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

  /**
   * The application came to the front: what waits for a connection is tried at once, and not after the pause that a
   * failed try would have been followed by.
   */
  async comeToFront(): Promise<void> {
    await this.openLaunchTarget()
    await this.openIncoming()
    await this.reconnector.wake()
  }

  /** Gives up on the actions that failed too often, and with them the files they carried. */
  async discardFailedActions(): Promise<void> {
    await discardFailedActions(this.services, this.store)
    await this.services.sweepCopies()
  }

  /** Lets go of what is open: the timers of the queue and of connecting again, and every connection. */
  stop(): void {
    this.reconnector.stop()
    this.services.queue.stop()
    this.services.connections.dropAll()
  }
}

/** Builds the application on a database that is open, and wires what the services report into the store. */
export function createApplication(
  db: SqlDb,
  platform: Platform,
  store: AppStore,
  /** What waits between two tries to connect again: the platform's timers, unless a test holds them. */
  timers?: ReconnectTimers
): Application {
  const reconnector = new Reconnector({
    needing: () => accountsNeedingConnection(db, services.connections),
    connect: (account) => connectAndRun(services.connections, services.mail)(account),
    log: platform.log,
    timers
  })
  const services: Services = createServices(db, platform, {
    connectionsChanged: (connectedIds) => {
      store.setConnected(connectedIds)
      reconnector.schedule()
    },
    queueChanged: async () => {
      await refreshQueueStatus(services, store)
      reconnector.schedule()
    }
  })
  return new Application(services, store, reconnector)
}
