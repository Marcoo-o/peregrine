import { parseTimeOfDay } from '@peregrine/core/notificationPolicy'
import { listAccounts } from '../accounts'
import type { PushState } from '../background/devices'
import { applyPush } from '../background/push'
import { describeError, explainError } from '../errors'
import {
  DEFAULT_QUIET_HOURS,
  loadListSettings,
  loadNotificationSettings,
  loadSendSettings,
  saveListSettings,
  saveNotificationSettings,
  saveSendSettings,
  type NotificationSettings
} from '../settings'
import { saveSort, type ListSort } from '../listSort'
import { loadLock } from '../lock'
import { appearance, saveAppearance, type AppearanceMode } from '../appearance'
import { saveSafety, type SafetySettings } from '../safety'
import type { LockController } from './LockController'
import type { Navigator } from './Navigator'
import type { Services } from './services'
import type { AppStore } from './store'

const NOT_ALLOWED =
  'Peregrine darf keine Benachrichtigungen zeigen. Das lässt sich in den Systemeinstellungen für die App ändern.'
const CONTACTS_NOT_ALLOWED =
  'Peregrine darf die Kontakte nicht lesen. Das lässt sich in den Systemeinstellungen für die App ändern.'
const SWITCHED_OFF = 'Benachrichtigungen sind ausgeschaltet.'
const LOOKING = 'Der Abruf läuft. Neue Nachrichten erscheinen als Benachrichtigung.'

/** The settings screen: what is said about new mail, and how often the phone looks for it. */
export class SettingsController {
  constructor(
    private readonly services: Services,
    private readonly store: AppStore,
    private readonly navigator: Navigator,
    private readonly locking: LockController
  ) {}

  /** Shows the settings as they are stored, with a line about what was just done when there is one. */
  async show(notice?: string): Promise<void> {
    const { db, notifications } = this.services
    this.store.showScreen({
      name: 'settings',
      settings: await loadNotificationSettings(db),
      list: await loadListSettings(db),
      sending: await loadSendSettings(db),
      lock: await loadLock(db),
      lockAvailable: await this.services.deviceLock.available(),
      accounts: await listAccounts(db),
      contactsPermitted: await this.services.deviceContacts.permitted(),
      permitted: await notifications.permitted(),
      push: await this.pushState(),
      notice
    })
  }

  /** Switches the line of text under the subjects in the lists on or off. */
  async setShowPreview(showPreview: boolean): Promise<void> {
    await saveListSettings(this.services.db, { showPreview })
    await this.show()
  }

  /**
   * Switches on or off that the people of the address book are suggested. Switching on is where the permission to read it is asked for,
   * and when the user does not give it the switch stays off, with the reason, as it does for notifications.
   */
  async setDeviceContacts(on: boolean): Promise<void> {
    const { db, deviceContacts } = this.services
    if (on && !(await deviceContacts.ensurePermission())) {
      await saveListSettings(db, { deviceContacts: false })
      await this.show(CONTACTS_NOT_ALLOWED)
      return
    }
    await saveListSettings(db, { deviceContacts: on })
    await this.show()
  }

  /** How long a message that was sent is held back so that it can be taken back, in seconds, 0 for not at all. */
  async setUndoSeconds(undoSeconds: number): Promise<void> {
    await saveSendSettings(this.services.db, { undoSeconds })
    await this.show()
  }

  /** Locks the application with the screen lock of the phone, or not. It asks for the lock to do either, and says why when it did not. */
  async setLock(enabled: boolean): Promise<void> {
    await this.show(await this.locking.setEnabled(enabled))
  }

  async setLockDelay(afterSeconds: number): Promise<void> {
    await this.locking.setDelay(afterSeconds)
    await this.show()
  }

  /** Whether the application is light, dark or follows the system: kept, and in force at once on every screen. */
  async setAppearance(mode: AppearanceMode): Promise<void> {
    appearance.set(await saveAppearance(this.services.db, mode))
    await this.show()
  }

  /** Switches the checks of links and attachments on or off: kept, and in force for the next link that is tapped. */
  async setSafety(change: Partial<SafetySettings>): Promise<void> {
    this.store.setSafety(await saveSafety(this.services.db, change))
  }

  /** How the lists of messages are ordered: kept, and every list shown is ordered so at once. */
  async setSort(sort: ListSort): Promise<void> {
    this.store.setSort(await saveSort(this.services.db, sort))
  }

  back(): Promise<void> {
    return this.navigator.showAccounts()
  }

  /**
   * Switches notifications on or off. Switching on is where the permission is asked for, and when the user
   * does not give it they stay off, with the reason: a switch that is on and shows nothing is worse than one
   * that says why it is not.
   */
  async setEnabled(enabled: boolean): Promise<void> {
    const { db, notifications } = this.services
    if (enabled && !(await notifications.ensurePermission())) {
      await saveNotificationSettings(db, { enabled: false })
      await this.applySchedule()
      await this.applyPush()
      await this.show(NOT_ALLOWED)
      return
    }
    await saveNotificationSettings(db, { enabled })
    await this.applySchedule()
    await this.applyPush()
    if (!enabled) await this.attempt(() => notifications.clearAll())
    await this.show()
  }

  /**
   * Switches on or off that the application keeps the connections to the mail servers open itself, which is what there is where
   * the system has no push service. It shows a notification for as long as it is on, and costs some battery, so it is off until
   * the user says so. What it watches is what the settings say, so the accounts are told to it at once.
   */
  async setKeepConnection(on: boolean): Promise<void> {
    await this.attempt(() => this.services.push.setKeepConnection(on))
    await this.applyPush()
    await this.show()
  }

  /** Opens the system's list of the applications that are free of the limits of the resting phone, where the connections hold best. */
  async openBatterySettings(): Promise<void> {
    await this.attempt(() => this.services.push.openBatterySettings())
  }

  setPreview(preview: boolean): Promise<void> {
    return this.change({ preview })
  }

  /** Switches the quiet hours on, with the usual night, or off. */
  setQuietHours(on: boolean): Promise<void> {
    return this.change(on ? DEFAULT_QUIET_HOURS : { quietFrom: '', quietTo: '' })
  }

  /** Changes one end of the quiet hours. What is not a time of day is not taken, and says so. */
  async setQuietTime(end: 'quietFrom' | 'quietTo', value: string): Promise<void> {
    if (parseTimeOfDay(value) === null) {
      await this.show('Bitte eine Uhrzeit wie 22:00 angeben.')
      return
    }
    await this.change({ [end]: value })
  }

  async toggleMuted(accountId: string): Promise<void> {
    const { mutedAccountIds } = await loadNotificationSettings(this.services.db)
    const muted = mutedAccountIds.includes(accountId)
    await this.change({
      mutedAccountIds: muted ? mutedAccountIds.filter((id) => id !== accountId) : [...mutedAccountIds, accountId]
    })
    await this.applyPush()
  }

  async setInterval(intervalMinutes: number): Promise<void> {
    await saveNotificationSettings(this.services.db, { intervalMinutes })
    await this.applySchedule()
    await this.show()
  }

  /** Looks for new mail once, now, which is also how to see that it works. */
  async runNow(): Promise<void> {
    const { db, syncSchedule } = this.services
    if (!(await loadNotificationSettings(db)).enabled) {
      await this.show(SWITCHED_OFF)
      return
    }
    try {
      await syncSchedule.runNow()
      await this.show(LOOKING)
    } catch (error) {
      await this.show(`Der Abruf ging nicht: ${explainError(error)}`)
    }
  }

  /**
   * Makes the platform's schedule what the settings say: a look every so often when notifications are on,
   * none when they are off. Idempotent, so it is run at every start and the schedule is right after a
   * reinstall or an update as well. A schedule the platform cannot be given is logged and stops nothing.
   */
  async applySchedule(): Promise<void> {
    const { db, syncSchedule } = this.services
    const settings = await loadNotificationSettings(db)
    await this.attempt(() => (settings.enabled ? syncSchedule.schedule(settings.intervalMinutes) : syncSchedule.cancel()))
  }

  /**
   * Tells the push service of the system what to watch, which is what the settings say: the inbox of each account that is
   * not muted when notifications are on. Idempotent, like the schedule, and run at every start.
   */
  async applyPush(): Promise<void> {
    const { db, push, log } = this.services
    await applyPush({ db, push, log })
  }

  /** What the phone has for being told at once; nothing when it cannot be asked. */
  private async pushState(): Promise<PushState> {
    try {
      return await this.services.push.state()
    } catch (error) {
      this.services.log.error(`the push state could not be read: ${describeError(error)}`)
      return { system: false, keepConnection: false }
    }
  }

  private async change(change: Partial<NotificationSettings>): Promise<void> {
    await saveNotificationSettings(this.services.db, change)
    await this.show()
  }

  private async attempt(work: () => Promise<void>): Promise<void> {
    try {
      await work()
    } catch (error) {
      this.services.log.error(`the platform could not be asked: ${describeError(error)}`)
    }
  }
}
