import type { PushDevice, PushSource } from './devices'

/** What the native module `PeregrinePush` offers, in the shapes that cross the bridge. */
export interface NativePush {
  available(): Promise<boolean>
  register(
    sourceId: string,
    host: string,
    port: number,
    security: string,
    username: string,
    password: string,
    mailbox: string
  ): Promise<void>
  unregister(sourceId: string): Promise<void>
  unregisterAll(): Promise<void>
}

/** The push service of the system, through the native module. */
export class RnPush implements PushDevice {
  constructor(private readonly native: NativePush) {}

  available(): Promise<boolean> {
    return this.native.available()
  }

  register(source: PushSource): Promise<void> {
    const { sourceId, host, port, security, username, password, mailbox } = source
    return this.native.register(sourceId, host, port, security, username, password, mailbox)
  }

  unregister(sourceId: string): Promise<void> {
    return this.native.unregister(sourceId)
  }

  unregisterAll(): Promise<void> {
    return this.native.unregisterAll()
  }
}
