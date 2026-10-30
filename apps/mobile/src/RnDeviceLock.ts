import type { DeviceLock } from './lock'

/** What the native module `PeregrineLock` offers, as it offers it. */
export interface NativeLock {
  available(): Promise<boolean>
  authenticate(title: string, description: string): Promise<boolean>
  setSecure(on: boolean): Promise<void>
}

/** The screen lock of the device, through the native module. */
export class RnDeviceLock implements DeviceLock {
  constructor(private readonly native: NativeLock) {}

  available(): Promise<boolean> {
    return this.native.available()
  }

  authenticate(title: string, description: string): Promise<boolean> {
    return this.native.authenticate(title, description)
  }

  setSecure(on: boolean): Promise<void> {
    return this.native.setSecure(on)
  }
}
