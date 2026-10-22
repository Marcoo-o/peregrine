import type { ImapSession } from '@peregrine/core/imapSession'
import { listAccounts, type Account } from '../accounts'
import { explainError } from '../errors'
import { listFolders, syncFolders, type Folder } from '../folders'
import { listMessages, unreadCounts } from '../messages'
import { searchMessages } from '../search'
import { loadSidebar, type SidebarData } from '../sidebar'
import { syncFolder } from '../sync'
import { listUnified, refreshRole, type RefreshResult, type UnifiedRole } from '../unified'
import { refreshQueueStatus } from './queueStatus'
import type { Services } from './services'
import type { AppStore } from './store'

const NO_CONNECTION_NOTICE = 'Keine Verbindung. Gezeigt wird, was schon geladen ist.'

/**
 * Which screen is shown when: the list of accounts, the unified inbox, the folders of an account and
 * the messages of a folder. What a screen shows is read from the database first and brought up to date
 * from the servers after, so that a server that is down costs a line that says so and not the screen.
 */
export class Navigator {
  constructor(
    private readonly services: Services,
    private readonly store: AppStore
  ) {}

  /** The first screen: the unified inbox when there are accounts to unify, the one account when there is one. */
  async start(): Promise<void> {
    const accounts = await listAccounts(this.services.db)
    if (accounts.length >= 2) await this.showUnified({ refresh: true })
    else if (accounts.length === 1) await this.openAccount(accounts[0])
    else await this.showAccounts()
  }

  /** What the sidebar shows, read from the database each time it is opened. */
  sidebar(): Promise<SidebarData> {
    return loadSidebar(this.services.db)
  }

  /** The list of accounts, or the form when there is none. */
  async showAccounts(error?: string): Promise<void> {
    this.store.setStatusAccount(null)
    const accounts = await listAccounts(this.services.db)
    this.store.showScreen(accounts.length === 0 ? { name: 'login', error } : { name: 'accounts', accounts, error })
  }

  showLogin(): void {
    this.store.showScreen({ name: 'login' })
  }

  /** Leaves the form for the list of accounts, when there is one to go back to, and says whether it did. */
  async leaveLogin(): Promise<boolean> {
    const accounts = await listAccounts(this.services.db)
    if (accounts.length === 0) return false
    await this.showAccounts()
    return true
  }

  /**
   * Connects an account and shows its folders. When it cannot be reached and has folders from before,
   * those are shown with the reason, and what is decided there waits for a connection.
   */
  async openAccount(account: Account): Promise<void> {
    this.store.showScreen({ name: 'loading' })
    this.store.setStatusAccount(account.id)
    try {
      await this.showFolders(account, await this.services.connections.ensure(account))
    } catch (error) {
      await this.showFoldersOffline(account, explainError(error))
    }
  }

  /** With a connection that works: replays what waited for one, takes the folders from the server. */
  async showFolders(account: Account, imap: ImapSession): Promise<void> {
    const { db, mail } = this.services
    this.store.setStatusAccount(account.id)
    await mail.flush(account.id)
    await syncFolders(db, account.id, await imap.listMailboxes())
    await this.showFoldersScreen(account)
    this.refreshStatus()
  }

  /**
   * A folder of an account, opened from the sidebar: the account is connected when it is not, what waited in its
   * queue is replayed, and the folder is fetched. When there is no connection the folder is shown as it was
   * stored, with the reason.
   */
  async openFolder(account: Account, folder: Folder): Promise<void> {
    this.store.setStatusAccount(account.id)
    try {
      await this.services.connections.ensure(account)
      await this.services.mail.flush(account.id)
    } catch (error) {
      await this.showStoredMessages(account, folder, { busy: false, error: explainError(error) })
      this.refreshStatus()
      return
    }
    await this.showMessages(account, folder, { sync: true })
    this.refreshStatus()
  }

  /** The folders as they were last fetched, for going back to them without asking the server. */
  async showStoredFolders(account: Account): Promise<void> {
    await this.showFoldersScreen(account)
  }

  /** The folders that are stored, with how much of each is not read, and what is to be said when the server could not be reached. */
  private async showFoldersScreen(account: Account, offline?: string): Promise<void> {
    const { db } = this.services
    const folders = await listFolders(db, account.id)
    this.store.showScreen({ name: 'folders', account, folders, unread: await unreadCounts(db, account.id), offline })
  }

  private async showFoldersOffline(account: Account, reason: string): Promise<void> {
    const folders = await listFolders(this.services.db, account.id)
    if (folders.length === 0) {
      await this.showAccounts(`${account.displayName}: ${reason}`)
      return
    }
    await this.showFoldersScreen(account, reason)
    this.refreshStatus()
  }

  /** The role of the list of all accounts that was shown last, which is the one shown again when none is asked for. */
  private unifiedRole: UnifiedRole = 'inbox'

  /**
   * The newest messages of the folders of a role, of every account, in one list: the inboxes unless it is told
   * another role, and the one shown last when it is told none. It is shown at once from what is stored and, when
   * asked, brought up to date after, account by account.
   */
  async showUnified(options: { refresh: boolean; role?: UnifiedRole }): Promise<void> {
    const { db, connections, mail } = this.services
    this.unifiedRole = options.role ?? this.unifiedRole
    const role = this.unifiedRole
    this.store.setStatusAccount(null)
    await this.showUnifiedList(options.refresh, [], 'navigating')
    if (!options.refresh) return

    const results = await refreshRole({ db, connections, mail }, await listAccounts(db), role)
    await this.showUnifiedList(false, results.filter((result) => result.error !== undefined), 'updating')
    this.refreshStatus()
  }

  /**
   * Going to the list always shows it. The update after a fetch only goes onto the list: not over a
   * screen the user has moved on to while the accounts were being fetched.
   */
  private async showUnifiedList(busy: boolean, problems: RefreshResult[], reason: 'navigating' | 'updating'): Promise<void> {
    const role = this.unifiedRole
    const messages = await listUnified(this.services.db, undefined, role)
    if (reason === 'updating' && this.store.screen.name !== 'unified') return
    this.store.showScreen({ name: 'unified', role, messages, busy, problems })
  }

  /** How many searches there have been, so that the newest is the one that is shown whichever finishes last. */
  private searches = 0

  /**
   * The messages that a search finds, from the database. `opening` is the search screen being entered, and
   * `typing` is the result for what has been typed since, which is shown only if it is the newest search and
   * the user is still on the screen for it.
   */
  async showSearch(query: string, reason: 'opening' | 'typing' = 'opening'): Promise<void> {
    const mine = ++this.searches
    const { messages, unsupported } = await searchMessages(this.services.db, query)
    if (mine !== this.searches) return
    if (reason === 'typing' && this.store.screen.name !== 'search') return
    this.store.showScreen({ name: 'search', query, messages, unsupported })
  }

  /** The messages of a folder from the database, and a sync with the server when asked to and there is one. */
  async showMessages(account: Account, folder: Folder, options: { sync: boolean }): Promise<void> {
    const imap = this.services.connections.get(account.id)
    if (!options.sync) return this.showStoredMessages(account, folder, { busy: false })
    if (!imap) return this.showStoredMessages(account, folder, { busy: false, error: NO_CONNECTION_NOTICE })

    await this.showStoredMessages(account, folder, { busy: true })
    try {
      await syncFolder(imap, this.services.db, folder)
      await this.showStoredMessages(account, folder, { busy: false })
    } catch (error) {
      await this.showStoredMessages(account, folder, { busy: false, error: explainError(error) })
    }
  }

  private async showStoredMessages(
    account: Account,
    folder: Folder,
    status: { busy: boolean; error?: string }
  ): Promise<void> {
    const { db } = this.services
    const folderNames = Object.fromEntries((await listFolders(db, account.id)).map((f) => [f.id, f.displayName]))
    const messages = await listMessages(db, folder.id)
    this.store.showScreen({ name: 'messages', account, folder, messages, folderNames, ...status })
  }

  /** Reads what waits in the queue into the store, without making anybody wait for it. */
  refreshStatus(): void {
    void refreshQueueStatus(this.services, this.store)
  }
}
