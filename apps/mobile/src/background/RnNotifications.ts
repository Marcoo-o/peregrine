import type { Notifications, SyncSchedule } from './devices'
import type { MailNotification, MessageTarget } from './notifications'

/** What the native module `PeregrineNotifications` offers, in the shapes that cross the bridge. */
export interface NativeNotifications {
  permitted(): Promise<boolean>
  ensurePermission(): Promise<boolean>
  show(options: {
    accountId: string
    title: string
    body: string
    subtitle?: string
    count: number
    target: MessageTarget
  }): Promise<void>
  clearAll(): Promise<void>
  consumeLaunchTarget(): Promise<MessageTarget | null>
}

/** The notifications of the device, through the native module. */
export class RnNotifications implements Notifications {
  constructor(private readonly native: NativeNotifications) {}

  permitted(): Promise<boolean> {
    return this.native.permitted()
  }

  ensurePermission(): Promise<boolean> {
    return this.native.ensurePermission()
  }

  show(notification: MailNotification): Promise<void> {
    const { accountId, title, body, subtitle, count, target } = notification
    // A subtitle that is not there is left out of what crosses the bridge, where it would be a null the
    // native side has to tell from a missing one.
    return this.native.show({ accountId, title, body, ...(subtitle === undefined ? {} : { subtitle }), count, target })
  }

  clearAll(): Promise<void> {
    return this.native.clearAll()
  }

  consumeLaunchTarget(): Promise<MessageTarget | null> {
    return this.native.consumeLaunchTarget()
  }
}

/** What the native module `PeregrineSync` offers. */
export interface NativeSync {
  schedule(minutes: number): Promise<void>
  cancel(): Promise<void>
  runNow(): Promise<void>
}

/** The schedule of the platform, through the native module. */
export class RnSyncSchedule implements SyncSchedule {
  constructor(private readonly native: NativeSync) {}

  schedule(minutes: number): Promise<void> {
    return this.native.schedule(minutes)
  }

  cancel(): Promise<void> {
    return this.native.cancel()
  }

  runNow(): Promise<void> {
    return this.native.runNow()
  }
}
