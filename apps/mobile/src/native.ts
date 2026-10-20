import { DeviceEventEmitter, NativeModules } from 'react-native'
import { RnNotifications, RnSyncSchedule } from './background/RnNotifications'
import { RnFiles } from './RnFiles'
import { RnTransport } from './RnTransport'

/**
 * Where the application meets the two native modules in `android/app/.../com/peregrinemobile`.
 * Everything that needs the device is reached from here, and nothing else imports `react-native`
 * for it, so the rest can be tested without one.
 */
export function createTransport(): RnTransport {
  return new RnTransport(NativeModules.PeregrineTransport, DeviceEventEmitter)
}

/** The files of the device: picking, reading what was picked, saving, handing a file to another application. */
export function createFiles(): RnFiles {
  return new RnFiles(NativeModules.PeregrineFiles)
}

/** The notifications of the device: the permission to show them, showing one, and where a tap on one led. */
export function createNotifications(): RnNotifications {
  return new RnNotifications(NativeModules.PeregrineNotifications)
}

/** The platform's schedule for looking for new mail while the application is closed. */
export function createSyncSchedule(): RnSyncSchedule {
  return new RnSyncSchedule(NativeModules.PeregrineSync)
}

/** The passphrase of the database, 64 hexadecimal characters, made on the first call. */
export function getDatabasePassphrase(): Promise<string> {
  return NativeModules.PeregrineKeystore.getDatabasePassphrase()
}
