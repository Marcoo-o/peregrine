import { AppRegistry } from 'react-native'
import { runAutoBackup } from '../autoBackup'
import { openDatabase } from '../database'
import { describeError } from '../errors'
import { createPlatform } from '../platform'

/** The key the native side starts the task by. It is `BackupScheduler.TASK_KEY` there. */
const TASK_KEY = 'PeregrineBackup'

/**
 * Registers the task the platform's scheduler runs to make a scheduled backup while the application is closed. It has no screen: it opens the database, makes the
 * backup, writes it into the folder through the native side, arms the next run, and ends. The end of the promise is what tells the native side that it is done.
 * Nothing in it is allowed to throw: a run that fails says so in the settings and is tried again after one interval.
 */
export function registerAutoBackup(): void {
  AppRegistry.registerHeadlessTask(TASK_KEY, () => async () => {
    const platform = createPlatform()
    try {
      const result = await runAutoBackup(await openDatabase(), platform.backupFolder)
      console.info(`the scheduled backup: ${result.status}`)
    } catch (error) {
      platform.log.error(`the scheduled backup failed: ${describeError(error)}`)
    }
  })
}
