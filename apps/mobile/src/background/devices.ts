import type { MessageTarget, Notifier } from './notifications'

/** The notifications of the device: showing them, being allowed to, and where a tap on one led. */
export interface Notifications extends Notifier {
  /** Whether notifications may be shown now, without asking. */
  permitted(): Promise<boolean>
  /** Whether they may be shown, asking the user for the permission first where there is one to ask for. */
  ensurePermission(): Promise<boolean>
  clearAll(): Promise<void>
  /** The message a notification was tapped for, once, or null when there is none. */
  consumeLaunchTarget(): Promise<MessageTarget | null>
}

/** The schedule for looking for new mail while the application is closed, which the platform keeps. */
export interface SyncSchedule {
  /** Looks every so many minutes, and changes the interval when one is scheduled. */
  schedule(minutes: number): Promise<void>
  cancel(): Promise<void>
  /** Looks once, now. */
  runNow(): Promise<void>
}
