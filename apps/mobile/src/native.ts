import { DeviceEventEmitter, NativeModules } from 'react-native'
import { RnTransport } from './RnTransport'

/**
 * Where the application meets the two native modules in `android/app/.../com/peregrinemobile`.
 * Everything that needs the device is reached from here, and nothing else imports `react-native`
 * for it, so the rest can be tested without one.
 */
export function createTransport(): RnTransport {
  return new RnTransport(NativeModules.PeregrineTransport, DeviceEventEmitter)
}

/** The passphrase of the database, 64 hexadecimal characters, made on the first call. */
export function getDatabasePassphrase(): Promise<string> {
  return NativeModules.PeregrineKeystore.getDatabasePassphrase()
}
