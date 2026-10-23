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

/** What the push service is told to watch for an account: where to connect and with what, and which mailbox. */
export interface PushSource {
  /** The account, so that the same account is the same source. */
  sourceId: string
  host: string
  port: number
  security: 'tls' | 'starttls'
  username: string
  password: string
  mailbox: string
}

/**
 * The push service of the system, where the device has one: a service that keeps the connections open for the
 * applications and wakes the application when something happens on one. Where there is none, `available` is false.
 */
export interface PushDevice {
  available(): Promise<boolean>
  /** Has the service watch the source, in place of the one with the same id. */
  register(source: PushSource): Promise<void>
  unregister(sourceId: string): Promise<void>
  unregisterAll(): Promise<void>
}

/** The schedule for looking for new mail while the application is closed, which the platform keeps. */
export interface SyncSchedule {
  /** Looks every so many minutes, and changes the interval when one is scheduled. */
  schedule(minutes: number): Promise<void>
  cancel(): Promise<void>
  /** Looks once, now. */
  runNow(): Promise<void>
}
