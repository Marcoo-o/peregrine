import { AppRegistry } from 'react-native'
import { createServices } from '../app/services'
import { openDatabase } from '../database'
import { describeError } from '../errors'
import { createPlatform } from '../platform'
import { NOTIFICATION_ACTIONS, runNotificationAction, type NotificationActionName } from './notificationAction'

/** The key the native side starts the task by. It is `NotificationActionScheduler.TASK_KEY` there. */
const TASK_KEY = 'PeregrineNotificationAction'

/** What the native side hands the task: which button, and the message it was on. */
interface ActionData {
  action?: string
  accountId?: string
  folderId?: string
  uid?: number
}

/**
 * Registers the task that a button of a notification starts ("Archive", "Mark read"). It has no screen: it opens the database, does the one thing, and ends.
 * Nothing in it is allowed to throw: one that fails logs, and the message stays as it is.
 */
export function registerNotificationAction(): void {
  AppRegistry.registerHeadlessTask(TASK_KEY, () => async (data?: ActionData) => {
    const platform = createPlatform()
    try {
      const action = NOTIFICATION_ACTIONS.find((known): known is NotificationActionName => known === data?.action)
      if (!action || !data?.accountId || !data.folderId || typeof data.uid !== 'number') {
        platform.log.error('a button of a notification was pressed with what it is not known by')
        return
      }
      const services = createServices(await openDatabase(), platform, {
        connectionsChanged: () => undefined,
        queueChanged: async () => undefined
      })
      const result = await runNotificationAction({ services, log: platform.log }, action, {
        accountId: data.accountId,
        folderId: data.folderId,
        uid: data.uid
      })
      console.info(`the ${action} of a notification: ${result}`)
    } catch (error) {
      platform.log.error(`the button of a notification failed: ${describeError(error)}`)
    }
  })
}
