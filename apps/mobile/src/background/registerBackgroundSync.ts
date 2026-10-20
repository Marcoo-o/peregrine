import { AppState, AppRegistry } from 'react-native'
import { createServices } from '../app/services'
import { openDatabase } from '../database'
import { describeError } from '../errors'
import { createPlatform } from '../platform'
import { runBackgroundSync } from './backgroundSync'

/** The key the native side starts the task by. It is `BackgroundSyncRunner.TASK_KEY` there. */
const TASK_KEY = 'PeregrineSync'

/**
 * Registers the task the platform's scheduler runs to look for new mail while the application is closed.
 * It has no screen: it opens the database, builds the services the application is made of, looks, and
 * ends. The end of the promise is what tells the native side that it is done.
 *
 * Nothing in it is allowed to throw. A task that fails only logs, and the platform would call it again at
 * the next time all the same, and a crash here would take the screen with it when the application is open.
 */
export function registerBackgroundSync(): void {
  AppRegistry.registerHeadlessTask(TASK_KEY, () => async () => {
    const platform = createPlatform()
    try {
      const services = createServices(await openDatabase(), platform, {
        connectionsChanged: () => undefined,
        queueChanged: async () => undefined
      })
      await runBackgroundSync({
        services,
        notifier: platform.notifications,
        // Whether the application is on the screen, which looks after its own mail.
        isForeground: () => AppState.currentState === 'active',
        log: platform.log
      })
    } catch (error) {
      platform.log.error(`the look for new mail failed: ${describeError(error)}`)
    }
  })
}
