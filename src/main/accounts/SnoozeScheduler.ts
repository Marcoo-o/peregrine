import type { SqlDb } from '../db/sqlDb'
import { app, BrowserWindow, Notification, type WebContents } from 'electron'
import { IpcChannels } from '@shared/ipcContracts'
import { parseMutedAccounts, shouldNotify, type NotificationPolicy } from '@peregrine/core/notificationPolicy'
import { clearExpiredSnoozes, listDueSnoozed, nextSnoozeDue } from '../db/repositories/messagesRepo'
import { getAppSettings } from '../db/repositories/appSettingsRepo'
import { notificationTexts } from './notificationTexts'

/**
 * Announces messages that were put aside once their moment arrives.
 *
 * The lists themselves need nothing from this: they compare `snoozed_until` against the
 * current time, so a message is back the next time anything is read. What is missing without
 * a scheduler is the reminder. And a "remind me later" that does not remind is a delete
 * button with extra steps.
 *
 * One timer for the whole mailbox, set to the earliest due message and re-armed after every
 * change. A timer per message would be thousands of them for a mailbox one actually uses.
 */
export class SnoozeScheduler {
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly db: SqlDb,
    private readonly getWebContents: () => WebContents | undefined
  ) {}

  /** Call after anything changed a snooze, and once at startup. */
  async reschedule(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null

    const due = await nextSnoozeDue(this.db)
    // Cleared once more: another call can have armed a timer while this one was reading, and
    // overwriting the field would leave that one running with nothing able to stop it.
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (due === null) return

    // setTimeout stores its delay in a 32-bit int, so anything past ~24.9 days fires at once.
    // Waking up daily until the real moment is close enough costs nothing and keeps a
    // reminder set for next month from arriving now.
    const MAX_DELAY = 24 * 3600_000
    const delay = Math.min(Math.max(due - Date.now(), 0), MAX_DELAY)
    this.timer = setTimeout(() => {
      void this.fire().catch((err) => {
        console.error('snooze reminder failed:', err instanceof Error ? err.message : err)
      })
    }, delay)
    // Unref'd so a pending reminder never keeps the process alive on its own.
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private async fire(): Promise<void> {
    const now = Date.now()
    const due = await listDueSnoozed(this.db, now)
    // Cleared right away, and before anything else can go wrong: a reminder left in place
    // would be found again on the next round, which, being overdue, fires at once. That is
    // an endless loop, not a reminder.
    await clearExpiredSnoozes(this.db, now)

    if (due.length > 0) {
      this.getWebContents()?.send(IpcChannels.snoozeDue, { count: due.length })
      await this.notify(due)
    }
    await this.reschedule()
  }

  private async notify(due: Awaited<ReturnType<typeof listDueSnoozed>>): Promise<void> {
    const settings = await getAppSettings(this.db)
    const policy: NotificationPolicy = {
      enabled: settings.notificationsEnabled,
      mutedAccountIds: parseMutedAccounts(settings.notificationMutedAccounts),
      quietFrom: settings.notificationQuietFrom,
      quietTo: settings.notificationQuietTo
    }
    // A reminder is deliberate, so a muted account is the only rule that applies to it: the
    // user asked for this one at this time. Quiet hours are respected all the same. It was
    // the user who picked a moment inside them, and the mail is not going anywhere.
    const first = due[0]
    if (!shouldNotify(policy, first.accountId, new Date())) return
    if (!Notification.isSupported()) return

    const texts = notificationTexts(settings.language, app.getLocale())
    const preview = settings.notificationPreview ? first : undefined
    const notification = new Notification({
      title: texts.snoozeTitle,
      body:
        due.length === 1 && preview
          ? preview.subject || texts.newMail
          : texts.snoozeCount(due.length)
    })

    notification.on('click', () => {
      const webContents = this.getWebContents()
      const window = webContents ? BrowserWindow.fromWebContents(webContents) : null
      window?.show()
      window?.focus()
      webContents?.send(IpcChannels.notificationActivated, {
        accountId: first.accountId,
        folderId: first.folderId,
        uid: first.uid
      })
    })
    notification.show()
  }
}
