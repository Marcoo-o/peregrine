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

/** Which ways the phone has to be told of new mail at once. */
export interface PushState {
  /** The system has a push service. */
  system: boolean
  /** The user switched on that the application keeps the connections itself, in a foreground service. */
  keepConnection: boolean
}

/**
 * The push service of the system, where the device has one: a service that keeps the connections open for the
 * applications and wakes the application when something happens on one. Where there is none, `available` is false.
 */
export interface PushDevice {
  /** Whether there is a way that the phone is told at once: the push service of the system, or the user's own connections. */
  available(): Promise<boolean>
  /** What there is: the system's push service, and whether the user switched on the application's own connections. */
  state(): Promise<PushState>
  /** Switches the application's own connections on or off. They are used only where the system has no push service. */
  setKeepConnection(on: boolean): Promise<void>
  /** Opens the system's list of the applications that are not limited in what they do while the phone rests. */
  openBatterySettings(): Promise<void>
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
