import type { SqlDb } from '../db/sqlDb'
import { app, BrowserWindow, Notification, type WebContents } from 'electron'
import { IpcChannels } from '@shared/ipcContracts'
import type {
  AccountConnectionStateEvent,
  ComposeInput,
  ConnectionState,
  MailNewEvent,
  MessageSummary,
  SyncProgressEvent
} from '@peregrine/core/types'
import {
  parseMutedAccounts,
  shouldNotify,
  type NotificationPolicy
} from '@peregrine/core/notificationPolicy'
import { notificationTexts } from './notificationTexts'
import { SnoozeScheduler } from './SnoozeScheduler'
import { OfflineQueue } from './OfflineQueue'
import { enqueueAction } from '../db/repositories/pendingActionsRepo'
import type { PendingActionKind, PendingPayload } from '@peregrine/core/pendingActions'
import { getMessageByUid, getMessageSummaryById } from '../db/repositories/messagesRepo'
import { getAccount, listAccounts } from '../db/repositories/accountsRepo'
import { getAppSettings } from '../db/repositories/appSettingsRepo'
import { getFolderByPath, listFolders } from '../db/repositories/foldersRepo'
import { loadCredentials } from '../credentials/CredentialStore'
import type { ImapSession, ImapSessionOptions } from '@peregrine/core/imapSession'
import { createImapSession } from '../imap/createSession'
import { syncFolderEnvelopes, syncFolderList, type NewMessageRef } from '../imap/syncEngine'
import { indexPendingBodies } from '../imap/bodyIndexer'
import { SmtpClient } from '../smtp/SmtpClient'
import { applyFilterRules } from '../filters/ruleEngine'

/**
 * One IMAP connection per account.
 *
 * It used to be two, so that IDLE could sit on the inbox without blocking everything else.
 * That was written before it was clear that imapflow idles on its own: it starts IDLE after
 * fifteen seconds of quiet, and every command breaks it and restarts it afterwards. The
 * second socket bought nothing and cost one connection per account. With a dozen mailboxes
 * on one server that is two dozen open connections, which is where mail servers start
 * refusing.
 */
interface AccountRuntime {
  imap: ImapSession
  smtp: SmtpClient
  stopped: boolean
  /** Timer for the periodic all-folder refresh; null while no round is scheduled. */
  syncTimer: NodeJS.Timeout | null
  /** Guards a scheduled round against overlapping a manual "fetch all" on the same socket. */
  syncing: boolean
}

// How often the scheduler wakes up while background sync is switched off, so that turning
// the setting back on takes effect without restarting the app.
const SYNC_DISABLED_RECHECK_MS = 60_000

/**
 * How many accounts may be connecting at the same moment.
 *
 * One connection each since the merge, so this is four sockets in flight. Well under the
 * per-user limit servers apply, and still fast enough that a dozen mailboxes come up in
 * three waves rather than twelve.
 */
const START_CONCURRENCY = 4

/**
 * Longest wait between reconnection attempts.
 *
 * Five minutes rather than thirty seconds: with a dozen accounts a short ceiling means a
 * dozen attempts per interval, which reads to a mail server exactly like an attack.
 */
const RECONNECT_MAX_MS = 300_000

export class AccountManager {
  private runtimes = new Map<string, AccountRuntime>()
  private snooze: SnoozeScheduler
  private offline: OfflineQueue

  constructor(
    private db: SqlDb,
    private getWebContents: () => WebContents | undefined
  ) {
    this.snooze = new SnoozeScheduler(db, getWebContents)
    this.offline = new OfflineQueue(db, getWebContents)
  }

  /**
   * Records an action that could not reach the server.
   *
   * Called by the IPC handlers when an account has no connection. They apply the change
   * locally either way, because the interface must not pretend nothing happened, and this is
   * makes sure the server hears about it too.
   */
  async enqueueOffline(
    accountId: string,
    kind: PendingActionKind,
    payload: PendingPayload,
    dueAt: number | null = null
  ): Promise<void> {
    await enqueueAction(this.db, accountId, kind, payload, dueAt)
    await this.offline.notify()
    if (dueAt !== null) await this.armDueTimer()
  }

  /**
   * Runs the queue of every connected account.
   *
   * Used by the timer for scheduled messages: at that moment nothing has just connected, so
   * there is no single account to flush. Whatever is due goes out on whichever connections
   * happen to be up.
   */
  flushAll(): void {
    for (const [accountId, runtime] of this.runtimes) {
      void this.offline.flush(accountId, runtime.imap)
    }
  }

  /** (Re-)sets the timer for the next scheduled message. */
  armDueTimer(): Promise<void> {
    return this.offline.rescheduleDue(() => this.flushAll())
  }

  /** Whether an account can currently talk to its server. The queue's only decision rule. */
  isConnected(accountId: string): boolean {
    return this.runtimes.has(accountId)
  }

  /** Handed in by the compose module, which is registered after this object exists. */
  setSendHandler(send: (input: ComposeInput) => Promise<unknown>): void {
    this.offline.setSendHandler(send)
  }

  /** Called after a snooze was set or cleared, and once the window is up. */
  rescheduleSnooze(): Promise<void> {
    return this.snooze.reschedule()
  }

  private emitConnectionState(event: AccountConnectionStateEvent): void {
    this.getWebContents()?.send(IpcChannels.accountConnectionState, event)
  }

  private emitMailNew(event: MailNewEvent): void {
    this.getWebContents()?.send(IpcChannels.mailNew, event)
  }

  /**
   * Applies the filter rules to a batch of arrivals and announces what is left.
   *
   * The order matters. Rules move junk out of the inbox and delete what was asked to be
   * deleted; notifying first means a notification for exactly the mail the user has already
   * decided not to see. The renderer, on the other hand, is told right away. The list must
   * not wait for rules that talk to the server. And again afterwards, because by then the
   * arrivals may sit in a different folder.
   */
  private async announceArrivals(
    accountId: string,
    folderId: string,
    imap: ImapSession,
    newMessages: NewMessageRef[]
  ): Promise<void> {
    if (newMessages.length === 0) return
    this.emitMailNew({ accountId, folderId, count: newMessages.length })

    const moved = await applyFilterRules(this.db, accountId, folderId, imap, newMessages)
    if (moved > 0) this.emitMailNew({ accountId, folderId, count: 0 })

    // A summary carries its current folder, so one lookup answers both questions: is the
    // message still there, and what does it say.
    const remaining = (
      await Promise.all(newMessages.map((ref) => getMessageSummaryById(this.db, ref.id)))
    ).filter((summary): summary is MessageSummary => summary?.folderId === folderId)
    if (remaining.length === 0) return

    await this.notifyNewMail(
      { accountId, folderId, count: remaining.length },
      remaining[remaining.length - 1]
    )
  }

  private emitSyncProgress(event: SyncProgressEvent): void {
    this.getWebContents()?.send(IpcChannels.syncProgress, event)
  }

  /**
   * Shows sender and subject rather than a bare count, and opens that message when clicked.
   * A notification you cannot act on is just noise.
   */
  private async notifyNewMail(event: MailNewEvent, newest?: MessageSummary): Promise<void> {
    const settings = await getAppSettings(this.db)
    const policy: NotificationPolicy = {
      enabled: settings.notificationsEnabled,
      mutedAccountIds: parseMutedAccounts(settings.notificationMutedAccounts),
      quietFrom: settings.notificationQuietFrom,
      quietTo: settings.notificationQuietTo
    }
    if (!shouldNotify(policy, event.accountId, new Date())) return
    if (!Notification.isSupported()) return

    const texts = notificationTexts(settings.language, app.getLocale())
    const account = await getAccount(this.db, event.accountId)
    const accountName = account?.displayName || account?.emailAddress || 'Peregrine'
    // Without the preview, the notification says that something arrived and for which
    // account. And nothing that a stranger looking at the screen would learn from.
    const preview = settings.notificationPreview ? newest : undefined
    const sender = preview ? preview.fromName || preview.fromAddress : ''

    const notification = new Notification({
      title: preview && event.count === 1 ? sender || accountName : accountName,
      body:
        event.count === 1 && preview
          ? preview.subject || texts.newMail
          : texts.newMailCount(event.count),
      subtitle: event.count === 1 ? accountName : undefined
    })

    if (newest) {
      notification.on('click', () => {
        const webContents = this.getWebContents()
        const window = webContents ? BrowserWindow.fromWebContents(webContents) : null
        window?.show()
        window?.focus()
        webContents?.send(IpcChannels.notificationActivated, {
          accountId: newest.accountId,
          folderId: newest.folderId,
          uid: newest.uid
        })
      })
    }

    notification.show()
  }

  async startAllAccounts(): Promise<void> {
    // Reminders that came due while the application was closed are announced on the next
    // start rather than dropped. The lists show them either way.
    await this.snooze.reschedule()
    /**
     * Accounts connect side by side. But only a few at a time.
     *
     * Sequentially, the waiting simply adds up: three accounts took 547 + 410 + 378 ms in a
     * row where the slowest alone would have done, and with a dozen mailboxes that is the
     * whole start.
     *
     * All at once is worse, and this is not theory: with twelve accounts on one server,
     * opening every connection together, two per account and so twenty-four, had *every*
     * account come up as failed. Mail servers cap how many connections one user may hold,
     * and a burst past that limit is refused rather than queued.
     *
     * Four at a time keeps the gain (a twelfth of the wall time becomes a quarter of it)
     * without ever presenting the server with a burst it will turn away. A failure stays
     * with its own account, so one unreachable server cannot hold up the others.
     */
    const accounts = await listAccounts(this.db)
    const queue = [...accounts]
    const worker = async (): Promise<void> => {
      for (let account = queue.shift(); account; account = queue.shift()) {
        await this.startAccount(account.id)
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(START_CONCURRENCY, accounts.length) }, worker)
    )
  }

  async startAccount(accountId: string): Promise<void> {
    if (this.runtimes.has(accountId)) return

    const account = await getAccount(this.db, accountId)
    if (!account) return
    const secrets = await loadCredentials(this.db, accountId)
    if (!secrets) return

    this.emitConnectionState({ accountId, state: 'connecting' })

    const connectionOptions: ImapSessionOptions = {
      host: account.imapHost,
      port: account.imapPort,
      secure: account.imapSecure,
      username: account.imapUsername,
      password: secrets.imapPassword
    }
    const { experimentalImapClient } = await getAppSettings(this.db)
    const imap = createImapSession(
      { ...connectionOptions, label: account.emailAddress },
      experimentalImapClient
    )
    const smtp = new SmtpClient({
      host: account.smtpHost,
      port: account.smtpPort,
      secure: account.smtpSecure,
      username: account.smtpUsername,
      password: secrets.smtpPassword,
      label: `${account.emailAddress} · SMTP`
    })

    const runtime: AccountRuntime = {
      imap,
      smtp,
      stopped: false,
      syncTimer: null,
      syncing: false
    }
    this.runtimes.set(accountId, runtime)

    try {
      await imap.connect()
      await syncFolderList(this.db, accountId, imap)

      const inbox = await getFolderByPath(this.db, accountId, 'INBOX')
      if (inbox) {
        const { folderId, newMessages } = await syncFolderEnvelopes(
          this.db,
          accountId,
          imap,
          'INBOX'
        )
        await applyFilterRules(this.db, accountId, folderId, imap, newMessages)
      }

      this.emitConnectionState({ accountId, state: 'connected' })

      // A connection being replaced (reconnect, or the account stopped) does not stop
      // listening to its old socket right away. That socket can still fire 'error' while it
      // tears down, and imapflow 1.6 raises one reliably for a write that arrives after
      // close. Without this guard that late event overwrites the state of whatever
      // connection replaced it, so the indicator gets stuck on red or yellow while the new
      // connection is doing its job.
      const isCurrent = (): boolean => this.runtimes.get(accountId) === runtime
      imap.onError((err) => {
        if (isCurrent()) this.emitConnectionState({ accountId, state: 'error', error: err.message })
      })
      imap.onClose(() => {
        if (!isCurrent() || runtime.stopped) return
        this.emitConnectionState({ accountId, state: 'reconnecting' })
        this.reconnectWithBackoff(accountId)
      })

      // Arrivals are reported by the connection itself, which idles on the inbox whenever
      // nothing else is going on. No separate loop and no second socket.
      imap.watchMailbox('INBOX', () => {
        const current = this.runtimes.get(accountId)?.imap
        if (!current) return
        void syncFolderEnvelopes(this.db, accountId, current, 'INBOX').then(
          ({ folderId, newMessages }) =>
            this.announceArrivals(accountId, folderId, current, newMessages)
        )
      })

      await this.scheduleBackgroundSync(accountId)

      // Deliberately not awaited: waiting here would hold up the scheduler behind whatever
      // the queue is doing, and a single slow message must not delay the mailbox becoming
      // usable. imapflow serialises everything on this connection through its mailbox lock.
      void this.offline.flush(accountId, imap)
    } catch (err) {
      this.runtimes.delete(accountId)
      this.emitConnectionState({
        accountId,
        state: 'error',
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  /**
   * Retries a dropped connection, backing off further and further.
   *
   * The ceiling is five minutes, not thirty seconds. The old cap was written with one
   * account in mind; with a dozen mailboxes on the same server it turns into two dozen
   * connection attempts every half minute, which is what flood protection on a mail server
   * is built to stop. And a server that has started dropping packets never sees a pause
   * long enough to forgive. A jitter of up to a fifth keeps the accounts from lining up and
   * arriving as one burst.
   */
  private reconnectWithBackoff(accountId: string, attempt = 1): void {
    const base = Math.min(RECONNECT_MAX_MS, 1000 * 2 ** attempt)
    const delayMs = base + Math.random() * base * 0.2
    setTimeout(() => {
      this.runtimes.delete(accountId)
      this.startAccount(accountId).catch(() => {
        this.reconnectWithBackoff(accountId, attempt + 1)
      })
    }, delayMs)
  }

  async stopAccount(accountId: string): Promise<void> {
    const runtime = this.runtimes.get(accountId)
    if (!runtime) return
    runtime.stopped = true
    if (runtime.syncTimer) clearTimeout(runtime.syncTimer)
    await runtime.imap.disconnect()
    this.runtimes.delete(accountId)
  }

  async stopAll(): Promise<void> {
    this.snooze.stop()
    this.offline.stop()
    for (const accountId of Array.from(this.runtimes.keys())) {
      await this.stopAccount(accountId)
    }
  }

  getSmtpClient(accountId: string): SmtpClient | undefined {
    return this.runtimes.get(accountId)?.smtp
  }

  /** Connection for on-demand/interactive operations (never used for IDLE). */
  getImapConnection(accountId: string): ImapSession | undefined {
    return this.runtimes.get(accountId)?.imap
  }

  async ensureFoldersSynced(accountId: string): Promise<void> {
    const imap = this.getImapConnection(accountId)
    if (!imap) return
    if ((await listFolders(this.db, accountId)).length === 0) {
      await syncFolderList(this.db, accountId, imap)
    }
  }

  async syncFolderNow(accountId: string, imapPath: string): Promise<void> {
    const imap = this.getImapConnection(accountId)
    if (!imap) return
    await syncFolderEnvelopes(this.db, accountId, imap, imapPath)
  }

  /**
   * Refreshes every folder of one account on its worker connection.
   *
   * Folders run one after another because a single IMAP connection can only have one mailbox
   * selected at a time. A folder that fails is reported and skipped rather than aborting the
   * round. One broken mailbox must not stop the rest from being refreshed.
   */
  async syncAccountFolders(accountId: string): Promise<number> {
    const runtime = this.runtimes.get(accountId)
    const imap = runtime?.imap
    if (!runtime || !imap || runtime.stopped) return 0
    // A round already in flight covers the same folders; joining it would only mean two
    // commands racing for the same socket.
    if (runtime.syncing) return 0
    runtime.syncing = true

    let synced = 0
    let folders: Awaited<ReturnType<typeof listFolders>> = []

    try {
      folders = await listFolders(this.db, accountId)
      const inbox = await getFolderByPath(this.db, accountId, 'INBOX')

      for (const [index, folder] of folders.entries()) {
        if (runtime.stopped) break
        this.emitSyncProgress({
          accountId,
          folderId: folder.id,
          phase: 'fetching',
          current: index,
          total: folders.length
        })
        try {
          const { folderId, newCount, newMessages } = await syncFolderEnvelopes(
            this.db,
            accountId,
            imap,
            folder.imapPath
          )
          synced += 1

          // Only inbox arrivals are announced and filtered: mail that the server itself
          // sorted into another folder is not "new mail" from the user's point of view,
          // and rules are written against the inbox.
          if (inbox && folderId === inbox.id && newCount > 0) {
            await this.announceArrivals(accountId, folderId, imap, newMessages)
          }
        } catch (err) {
          console.error(
            `background sync of ${folder.imapPath} failed:`,
            err instanceof Error ? err.message : err
          )
        }
      }

      // Envelopes first, bodies after: the list has to be up to date before the connection
      // goes off to fill the search index with what is now known to be missing.
      await indexPendingBodies(this.db, accountId, imap, () => runtime.stopped)
    } finally {
      runtime.syncing = false
      this.emitSyncProgress({
        accountId,
        folderId: '',
        phase: 'done',
        current: folders.length,
        total: folders.length
      })
    }

    return synced
  }

  /** Refreshes all accounts at once; each one has its own connection, so they do not queue up. */
  async syncAllAccounts(): Promise<number> {
    const counts = await Promise.all(
      Array.from(this.runtimes.keys()).map(async (accountId) => {
        try {
          return await this.syncAccountFolders(accountId)
        } catch (err) {
          console.error('background sync failed:', err instanceof Error ? err.message : err)
          return 0
        }
      })
    )
    return counts.reduce((sum, n) => sum + n, 0)
  }

  /**
   * Chains the periodic refresh with setTimeout rather than setInterval: the interval is
   * re-read from the settings before every round, so a changed value takes effect after the
   * current wait instead of needing a restart, and a slow round can never stack up on itself.
   */
  private async scheduleBackgroundSync(accountId: string): Promise<void> {
    const runtime = this.runtimes.get(accountId)
    if (!runtime || runtime.stopped) return
    if (runtime.syncTimer) clearTimeout(runtime.syncTimer)

    const minutes = (await getAppSettings(this.db)).syncIntervalMinutes
    // The account can have been stopped while the setting was being read.
    if (runtime.stopped) return
    // Cleared once more: a second call can have armed a timer in the meantime.
    if (runtime.syncTimer) clearTimeout(runtime.syncTimer)
    const delayMs = minutes > 0 ? minutes * 60_000 : SYNC_DISABLED_RECHECK_MS

    runtime.syncTimer = setTimeout(() => {
      const current = this.runtimes.get(accountId)
      if (!current || current.stopped) return
      const round = getAppSettings(this.db).then((settings) =>
        settings.syncIntervalMinutes > 0 ? this.syncAccountFolders(accountId) : 0
      )
      void round
        .catch((err) => {
          console.error('background sync failed:', err instanceof Error ? err.message : err)
        })
        .finally(() =>
          this.scheduleBackgroundSync(accountId).catch((err) => {
            console.error('scheduling the background sync failed:', err instanceof Error ? err.message : err)
          })
        )
    }, delayMs)
    // A pending sync must not keep the process alive on quit.
    runtime.syncTimer.unref?.()
  }
}

export type { ConnectionState }
