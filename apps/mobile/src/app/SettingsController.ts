import { parseTimeOfDay } from '@peregrine/core/notificationPolicy'
import { listAccounts } from '../accounts'
import { describeError, explainError } from '../errors'
import {
  DEFAULT_QUIET_HOURS,
  loadNotificationSettings,
  saveNotificationSettings,
  type NotificationSettings
} from '../settings'
import type { Navigator } from './Navigator'
import type { Services } from './services'
import type { AppStore } from './store'

const NOT_ALLOWED =
  'Peregrine darf keine Benachrichtigungen zeigen. Das lässt sich in den Systemeinstellungen für die App ändern.'
const SWITCHED_OFF = 'Benachrichtigungen sind ausgeschaltet.'
const LOOKING = 'Der Abruf läuft. Neue Nachrichten erscheinen als Benachrichtigung.'

/** The settings screen: what is said about new mail, and how often the phone looks for it. */
export class SettingsController {
  constructor(
    private readonly services: Services,
    private readonly store: AppStore,
    private readonly navigator: Navigator
  ) {}

  /** Shows the settings as they are stored, with a line about what was just done when there is one. */
  async show(notice?: string): Promise<void> {
    const { db, notifications } = this.services
    this.store.showScreen({
      name: 'settings',
      settings: await loadNotificationSettings(db),
      accounts: await listAccounts(db),
      permitted: await notifications.permitted(),
      notice
    })
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
      await this.show(NOT_ALLOWED)
      return
    }
    await saveNotificationSettings(db, { enabled })
    await this.applySchedule()
    if (!enabled) await this.attempt(() => notifications.clearAll())
    await this.show()
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
