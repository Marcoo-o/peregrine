import { parseAddress } from '@peregrine/smtp/headers'
import { refusalForOpening } from '@peregrine/core/attachmentSafety'
import { SNIFF_BYTES } from '@peregrine/core/fileType'
import type { Account } from '../accounts'
import { getAccount, listAccounts } from '../accounts'
import { attachmentContent, listAttachments, type AttachmentInfo } from '../attachments'
import { refusalText } from '../attachmentText'
import { describeError, explainError } from '../errors'
import { FLAGGED, SEEN } from '../flags'
import { getFolder, getFolderBySpecialUse, listFolders, type Folder } from '../folders'
import type { MailActions } from '../mailActions'
import { listMessages, type StoredMessage } from '../messages'
import { readMessage } from '../messageText'
import { assessMessage, isOwnAddress, knownDomainsOf } from '../reading/assessment'
import type { SearchHit } from '../search'
import { isFirstContact, messagesFrom } from '../senderHistory'
import type { UnifiedMessage } from '../unified'
import type { MessageTarget } from '../background/notifications'
import type { Navigator } from './Navigator'
import type { MessageOrigin, MessageState, MoveState } from './screens'
import type { Services } from './services'
import type { AppStore } from './store'

/** What can be done to an open message. */
type OnOpenMessage = MessageState | MoveState

/**
 * Working on one message: opening it, marking it, moving or deleting it, and saving or opening what is
 * attached to it. Every change to mail goes through the actions of the queue, so it shows at once and
 * reaches the server when there is a connection.
 */
export class MessageController {
  constructor(
    private readonly services: Services,
    private readonly store: AppStore,
    private readonly navigator: Navigator
  ) {}

  /** Opens a message of the unified list, which knows its account and folder by id. */
  async openFromUnified(message: UnifiedMessage): Promise<void> {
    const { db } = this.services
    const account = await getAccount(db, message.accountId)
    const folder = await getFolder(db, message.folderId)
    if (account && folder) await this.open(account, folder, message, 'unified')
  }

  /** Opens a message that a search found, and remembers the search, which leaving the message goes back to. */
  async openFromSearch(message: SearchHit, query: string): Promise<void> {
    const { db } = this.services
    const account = await getAccount(db, message.accountId)
    const folder = await getFolder(db, message.folderId)
    if (account && folder) await this.open(account, folder, message, 'search', query)
  }

  /** Opens the message a notification was tapped for, if the application still has it. */
  async openTarget(target: MessageTarget): Promise<void> {
    const { db } = this.services
    const account = await getAccount(db, target.accountId)
    const folder = await getFolder(db, target.folderId)
    if (!account || !folder) return
    const summary = (await listMessages(db, folder.id)).find((message) => message.uid === target.uid)
    if (summary) await this.open(account, folder, summary, 'folder')
  }

  /**
   * Opens a message: marks it read, which is made here at once and told to the server through the
   * queue, and fetches its text, which needs the server and says why when it cannot have it.
   */
  async open(
    account: Account,
    folder: Folder,
    summary: StoredMessage,
    origin: MessageOrigin,
    searchQuery?: string
  ): Promise<void> {
    const opened = { account, folder, summary, origin, searchQuery }
    this.store.showScreen({ name: 'message', ...opened })
    if (!summary.flags.includes(SEEN)) this.markRead(folder, summary)
    try {
      const imap = await this.services.connections.ensure(account)
      const full = await imap.fetchFullMessage(folder.imapPath, summary.uid)
      if (!full) throw new Error('Die Nachricht gibt es auf dem Server nicht mehr')
      const message = readMessage(full.source)
      const accounts = await listAccounts(this.services.db)
      const knownDomains = knownDomainsOf(accounts)
      // What the user wrote themselves, a draft or a copy in the sent folder, is not a first message from anybody.
      const sender = parseAddress(message.from).address
      const firstContact = !isOwnAddress(accounts, sender) && isFirstContact(await messagesFrom(this.services.db, sender))
      this.store.showScreen({
        name: 'message',
        ...opened,
        message,
        assessment: assessMessage(message, knownDomains, firstContact),
        knownDomains,
        source: full.source,
        attachments: this.attachmentsOf(full.source)
      })
    } catch (error) {
      this.store.showScreen({ name: 'message', ...opened, error: explainError(error) })
    }
  }

  private markRead(folder: Folder, summary: StoredMessage): void {
    this.services.mail.setFlags(folder, [summary.uid], [SEEN], []).catch((error) => this.services.log.error(describeError(error)))
  }

  /** The attachments of a message. One that cannot be read for them is shown without, and not refused. */
  private attachmentsOf(source: Uint8Array): AttachmentInfo[] {
    try {
      return listAttachments(source)
    } catch (error) {
      this.services.log.error(`reading the attachments failed: ${describeError(error)}`)
      return []
    }
  }

  /** Back to the list the message was opened from, which shows what was done to it. */
  async leave(from: OnOpenMessage): Promise<void> {
    if (from.origin === 'unified') await this.navigator.showUnified({ refresh: false })
    else if (from.origin === 'search') await this.navigator.showSearch(from.searchQuery ?? '')
    else await this.navigator.showMessages(from.account, from.folder, { sync: false })
  }

  async markUnread(state: MessageState): Promise<void> {
    await this.leaveAfter(state, (mail) => mail.setFlags(state.folder, [state.summary.uid], [], [SEEN]))
  }

  async delete(state: MessageState): Promise<void> {
    await this.leaveAfter(state, (mail) => mail.remove(state.folder, [state.summary.uid]))
  }

  /** Stars the message or takes the star off, and stays on it. */
  async toggleFlagged(state: MessageState): Promise<void> {
    const { mail, db } = this.services
    const flagged = state.summary.flags.includes(FLAGGED)
    await mail.setFlags(state.folder, [state.summary.uid], flagged ? [] : [FLAGGED], flagged ? [FLAGGED] : [])
    const fresh = (await listMessages(db, state.folder.id)).find((message) => message.uid === state.summary.uid)
    if (fresh) this.store.showScreen({ ...state, summary: fresh })
  }

  /** Puts the message into the archive of its account, or says that there is none. */
  async archive(state: MessageState): Promise<void> {
    await this.moveToRole(state, '\\Archive', 'Für dieses Konto ist kein Archivordner vorhanden')
  }

  /** Puts the message into the spam folder of its account, or says that there is none. */
  async markAsJunk(state: MessageState): Promise<void> {
    await this.moveToRole(state, '\\Junk', 'Für dieses Konto ist kein Spam-Ordner vorhanden')
  }

  private async moveToRole(state: MessageState, role: string, missing: string): Promise<void> {
    const target = await getFolderBySpecialUse(this.services.db, state.account.id, role)
    if (!target) {
      this.showNotice(state, missing)
      return
    }
    await this.move(this.asMove(state), target)
  }

  /** What a move needs of a message that is open, without the choice of a folder having been shown. */
  private asMove(state: MessageState): MoveState {
    const { account, folder, summary, origin, searchQuery } = state
    return { name: 'move', account, folder, summary, origin, searchQuery, targets: [], returnTo: state }
  }

  /** Shows the folders the message can go to. */
  async startMove(state: MessageState): Promise<void> {
    const folders = await listFolders(this.services.db, state.account.id)
    const targets = folders.filter((folder) => folder.id !== state.folder.id)
    const { account, folder, summary, origin, searchQuery } = state
    this.store.showScreen({ name: 'move', account, folder, summary, origin, searchQuery, targets, returnTo: state })
  }

  async move(state: MoveState, target: Folder): Promise<void> {
    await this.leaveAfter(state, (mail) => mail.move(state.folder, [state.summary.uid], target))
  }

  /** Back from the choice of a folder to the message, as it was. */
  cancelMove(state: MoveState): void {
    this.store.showScreen(state.returnTo)
  }

  /** Runs an action on the open message, and then shows the list again, where its effect is to be seen. */
  private async leaveAfter(state: OnOpenMessage, action: (mail: MailActions) => Promise<void>): Promise<void> {
    try {
      await action(this.services.mail)
    } catch (error) {
      this.services.log.error(describeError(error))
    }
    await this.leave(state)
  }

  /** Saves an attachment where the user chooses. Keeping a file is their decision, so there is no check. */
  async saveAttachment(state: MessageState, info: AttachmentInfo): Promise<void> {
    const content = this.contentOf(state, info)
    if (!content) return
    try {
      const saved = await this.services.files.save(info.filename, info.contentType, content)
      this.showNotice(state, saved ? `Gespeichert: ${info.filename}` : undefined)
    } catch (error) {
      this.showNotice(state, `Speichern ging nicht: ${explainError(error)}`)
    }
  }

  /** Hands an attachment to another application, unless it would start a program or is not what its name says. */
  async openAttachment(state: MessageState, info: AttachmentInfo): Promise<void> {
    const content = this.contentOf(state, info)
    if (!content) return
    const refused = refusalForOpening(info.filename, content.subarray(0, SNIFF_BYTES))
    if (refused) {
      this.showNotice(state, refusalText(refused))
      return
    }
    try {
      await this.services.files.open(info.filename, info.contentType, content)
      this.showNotice(state, undefined)
    } catch (error) {
      this.showNotice(state, `Öffnen ging nicht: ${explainError(error)}`)
    }
  }

  private contentOf(state: MessageState, info: AttachmentInfo): Uint8Array | undefined {
    return state.source ? attachmentContent(state.source, info.id) : undefined
  }

  /** Says something about the last thing done, unless the user has moved on to another screen meanwhile. */
  private showNotice(state: MessageState, notice: string | undefined): void {
    if (this.store.screen !== state) return
    this.store.showScreen({ ...state, notice })
  }
}
