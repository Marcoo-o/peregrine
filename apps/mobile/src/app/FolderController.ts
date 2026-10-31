import type { Account } from '../accounts'
import { explainError } from '../errors'
import { folderNameProblem, folderUids, isChangeable, isEmptiable, namesIn, pathWithName, renameFolderRows, renamedPath } from '../folderOps'
import { getFolder, listFolders, syncFolders, type Folder } from '../folders'
import type { Navigator } from './Navigator'
import type { FolderToolsState } from './screens'
import type { Services } from './services'
import type { AppStore } from './store'
import { msg, t, tn } from '../i18n'

const NO_CONNECTION = msg('Dafür braucht es eine Verbindung zum Server, und die gibt es gerade nicht.')

/**
 * What can be done to the folders of an account: make one, give one another name, delete one, mark all of one as read, empty the trash.
 *
 * Changing the folders themselves is not put into the queue. A new name or a folder that is gone changes what every other action
 * names, and a rename that waited for a connection would let the actions behind it run against a folder that is not there under that
 * name. So it needs a connection and says so when there is none. Marking as read and emptying are decisions about messages like any
 * other: they are made on the stored copy at once and go through the queue.
 */
export class FolderController {
  constructor(
    private readonly services: Services,
    private readonly store: AppStore,
    private readonly navigator: Navigator
  ) {}

  /** The screen for a new folder, which can sit inside another. */
  async startCreate(account: Account): Promise<void> {
    this.store.showScreen({ name: 'folderTools', account, folder: null, folders: await listFolders(this.services.db, account.id) })
  }

  /** The screen for what can be done to one folder. */
  async startTools(account: Account, folder: Folder): Promise<void> {
    this.store.showScreen({ name: 'folderTools', account, folder, folders: await listFolders(this.services.db, account.id) })
  }

  /** Back to where it started: the list of the folder, or the folders when there was none. */
  back(state: FolderToolsState): Promise<void> {
    return state.folder ? this.navigator.showMessages(state.account, state.folder, { sync: false }) : this.navigator.showStoredFolders(state.account)
  }

  /** Makes a folder, inside another when `parentPath` names one, and shows the folders with it. */
  async create(state: FolderToolsState, name: string, parentPath: string | null): Promise<void> {
    await this.structural(state, async (imap) => {
      const delimiter = await imap.pathDelimiter()
      const problem = folderNameProblem(name, delimiter, namesIn(state.folders, parentPath))
      if (problem) return problem
      await imap.createMailbox(pathWithName(parentPath, name, delimiter))
      return null
    })
  }

  /** Gives a folder another name. It keeps what is stored of it and what waits for it in the queue. */
  async rename(state: FolderToolsState, name: string): Promise<void> {
    const folder = state.folder
    if (!folder || !isChangeable(folder)) return
    await this.structural(state, async (imap) => {
      const delimiter = await imap.pathDelimiter()
      const problem = folderNameProblem(name, delimiter, namesIn(state.folders, folder.parentPath), folder.displayName)
      if (problem) return problem
      if (name.trim() === folder.displayName) return null
      const next = renamedPath(folder.imapPath, name, delimiter)
      await imap.renameMailbox(folder.imapPath, next)
      await renameFolderRows(this.services.db, folder.accountId, folder.imapPath, next, delimiter)
      return null
    })
  }

  /** Deletes a folder on the server, with what it holds there, and takes it out of what is stored. */
  async remove(state: FolderToolsState): Promise<void> {
    const folder = state.folder
    if (!folder || !isChangeable(folder)) return
    await this.structural(state, async (imap) => {
      await imap.deleteMailbox(folder.imapPath)
      return null
    })
  }

  /** Marks every message of the folder as read. A decision about messages: it is made here at once and the queue tells the server. */
  async markAllRead(state: FolderToolsState): Promise<void> {
    const folder = state.folder
    if (!folder) return
    await this.about(state, async () => {
      const unread = await folderUids(this.services.db, folder.id, { unreadOnly: true })
      await this.services.mail.setFlags(folder, unread, ['\\Seen'], [])
      return unread.length === 0 ? t('Es gibt nichts Ungelesenes in diesem Ordner.') : tn(unread.length, '{count} Nachricht ist jetzt gelesen.', '{count} Nachrichten sind jetzt gelesen.')
    })
  }

  /** Deletes every message of the trash or the junk folder for good. */
  async empty(state: FolderToolsState): Promise<void> {
    const folder = state.folder
    if (!folder || !isEmptiable(folder)) return
    await this.about(state, async () => {
      const all = await folderUids(this.services.db, folder.id)
      await this.services.mail.remove(folder, all, { permanent: true })
      return all.length === 0 ? t('Der Ordner ist schon leer.') : tn(all.length, '{count} Nachricht ist gelöscht.', '{count} Nachrichten sind gelöscht.')
    })
  }

  /**
   * A change to the folders: needs a connection, is tried against the server, and the folders are taken from the server after, so that what
   * is shown is what it has. What the server refuses is said, with the form kept as it was; what is done goes back to the folders.
   */
  private async structural(
    state: FolderToolsState,
    change: (imap: NonNullable<ReturnType<Services['connections']['get']>>) => Promise<string | null>
  ): Promise<void> {
    this.store.showScreen({ ...state, busy: true, error: undefined, notice: undefined })
    const imap = this.services.connections.get(state.account.id)
    if (!imap) {
      this.store.showScreen({ ...state, busy: false, error: t(NO_CONNECTION) })
      return
    }
    try {
      const problem = await change(imap)
      if (problem) {
        this.store.showScreen({ ...state, busy: false, error: problem })
        return
      }
      await syncFolders(this.services.db, state.account.id, await imap.listMailboxes())
      await this.navigator.showStoredFolders(state.account)
    } catch (error) {
      this.store.showScreen({ ...state, busy: false, error: explainError(error) })
    }
  }

  /** A decision about the messages of the folder, with a line about what was done, on the same screen. */
  private async about(state: FolderToolsState, act: () => Promise<string>): Promise<void> {
    this.store.showScreen({ ...state, busy: true, error: undefined, notice: undefined })
    try {
      const notice = await act()
      const folder = (await getFolder(this.services.db, state.folder?.id ?? '')) ?? state.folder
      this.store.showScreen({ ...state, folder, busy: false, notice })
      this.navigator.refreshStatus()
    } catch (error) {
      this.store.showScreen({ ...state, busy: false, error: explainError(error) })
    }
  }
}
