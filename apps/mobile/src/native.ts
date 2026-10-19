import { DeviceEventEmitter, NativeModules } from 'react-native'
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

/** The passphrase of the database, 64 hexadecimal characters, made on the first call. */
export function getDatabasePassphrase(): Promise<string> {
  return NativeModules.PeregrineKeystore.getDatabasePassphrase()
}
