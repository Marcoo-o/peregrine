import { listAccounts, type Account } from '../accounts'
import { mergeSuggestions, suggestContacts, SUGGESTIONS, type Contact } from '../contacts'
import { editableDraft, emptyDraft, forwardDraft, recipientAddresses, replyAllDraft, replyDraft, toComposeInput, type Draft } from '../draft'
import { bringAttachments, notBroughtText } from '../draftAttachments'
import { draftsFolderOf } from '../drafts'
import { draftFromIncoming, type Incoming } from '../incoming'
import { newId } from '../ids'
import { explainError } from '../errors'
import { protectionProblem } from '../pgp/protect'
import type { ProtectionDefaults } from '../pgp/protectionDefaults'
import { smtpSettingsOf } from '../send'
import { loadListSettings } from '../settings'
import { autosaveDue } from './autosave'
import type { Navigator } from './Navigator'
import type { ComposeState, MessageState, Screen } from './screens'
import type { Services } from './services'
import type { AppStore } from './store'

/** Why an account cannot send, as a line for the screen, or null when it can. */
export function senderProblem(account: Account): string | null {
  if (!account.emailAddress) return 'Zu diesem Konto gibt es keine Absenderadresse.'
  if (!smtpSettingsOf(account)) return 'Zu diesem Konto ist kein Server zum Senden eingetragen.'
  return null
}

/** Writing a message: starting one, sending it into the queue, or giving it up. */
export class ComposeController {
  /** The draft that was last handed to the queue for each writing of a message, which is what is kept once the queue has run. */
  private readonly keeping = new Map<string, Draft>()

  constructor(
    private readonly services: Services,
    private readonly store: AppStore,
    private readonly navigator: Navigator,
    private readonly protection: ProtectionDefaults
  ) {
    // A draft that waited for a connection is kept when the queue runs, which can be while the message is still on the screen.
    services.mail.onDraftKept((session, kept) => {
      const shown = this.store.screen
      if (shown.name !== 'compose' || shown.session !== session) return
      this.store.showScreen({
        ...shown,
        saved: kept.uid === null ? undefined : { folder: kept.folder, uid: kept.uid },
        savedDraft: this.keeping.get(session) ?? shown.savedDraft,
        autosave: { status: 'saved', at: Date.now() },
        noAutosave: kept.uid === null
      })
    })
  }

  /** An empty message from an account, and the screen to show again when it is done with. */
  startNew(account: Account, returnTo: Screen): void {
    this.show({ account, returnTo, draft: this.started(account, emptyDraft) })
  }

  /**
   * An empty message from the first account, for the places that are not an account's: the list of all inboxes, a
   * search. The account it is written from can be another one that the user has, and is told on the screen.
   */
  async startNewFromAnyAccount(returnTo: Screen): Promise<void> {
    const [first] = await listAccounts(this.services.db)
    if (first) this.startNew(first, returnTo)
  }

  /**
   * The message that another application asked for, a link to an address or something shared with this one. It is written from the first
   * account that can send, or from the first there is when none can, which the screen then says. Returns whether it was started: it is not
   * when there is no account to write from, and the files that came are then removed again.
   */
  async startFromIncoming(incoming: Incoming): Promise<boolean> {
    const accounts = await listAccounts(this.services.db)
    const account = accounts.find((candidate) => senderProblem(candidate) === null) ?? accounts[0]
    if (!account) {
      await this.services.files.remove(incoming.files.map((file) => file.path)).catch(() => undefined)
      return false
    }
    const { draft, error } = await draftFromIncoming(incoming, this.services.files)
    this.show({ account, returnTo: this.store.screen, draft: this.started(account, draft), error })
    return true
  }

  /**
   * The people to suggest for an address that is being typed: those the phone has mail from, without the user's own, and when the user
   * switched it on and allowed it, those of the device's address book. An address book that cannot be read leaves the others.
   */
  async suggest(typed: string): Promise<Contact[]> {
    const { db, deviceContacts } = this.services
    const accounts = await listAccounts(db)
    const own = accounts.map((account) => account.emailAddress.toLowerCase())
    const history = await suggestContacts(db, typed, accounts.map((account) => account.emailAddress))
    if (!(await loadListSettings(db)).deviceContacts) return history
    try {
      if (!(await deviceContacts.permitted())) return history
      const book = (await deviceContacts.search(typed, SUGGESTIONS * 2)).filter((contact) => !own.includes(contact.address.toLowerCase()))
      return mergeSuggestions(history, book, SUGGESTIONS)
    } catch (error) {
      this.services.log.warn(`the address book could not be read: ${explainError(error)}`)
      return history
    }
  }

  /** An answer to the open message, once its text is there to quote. */
  startReply(state: MessageState): void {
    if (!state.message) return
    this.show({ account: state.account, returnTo: state, draft: this.started(state.account, replyDraft(state.message)) })
  }

  /** An answer to everybody the open message went to. */
  startReplyAll(state: MessageState): void {
    if (!state.message) return
    this.show({
      account: state.account,
      returnTo: state,
      draft: this.started(state.account, replyAllDraft(state.message, state.account.emailAddress))
    })
  }

  /** The open message, to be passed on to somebody. */
  /**
   * A message to be passed on, with the attachments of the original: each is a file of the phone on the new message and can be
   * taken off before it is sent. What cannot be carried (too large for a message, or not readable) is said on the screen.
   */
  async startForward(state: MessageState): Promise<void> {
    if (!state.message) return
    const draft = this.started(state.account, forwardDraft(state.message))
    const infos = state.attachments ?? []
    if (infos.length === 0) {
      this.show({ account: state.account, returnTo: state, draft })
      return
    }
    try {
      const brought = await bringAttachments(state.source, infos, this.services.files)
      this.show({
        account: state.account,
        returnTo: state,
        draft: { ...draft, attachments: brought.attachments },
        error: notBroughtText(brought)
      })
    } catch (error) {
      this.store.showScreen({ ...state, notice: `Die Anhänge konnten nicht übernommen werden: ${explainError(error)}` })
    }
  }

  /**
   * A message kept as a draft, to be written on, with the files that are attached to it. Opened only when saving it again would
   * keep all of it: the reason it cannot be is said on the message, where the user asked for it. That is a formatting the phone
   * cannot write, and attachments it cannot take over whole, since saving would then drop them from the server's copy.
   */
  async startFromDraft(state: MessageState): Promise<void> {
    if (!state.message) return
    const found = editableDraft(state.message)
    if ('refusal' in found) {
      this.store.showScreen({ ...state, notice: found.refusal })
      return
    }
    // A draft that was kept encrypted is written on encrypted, and one that was kept signed, signed.
    const protection = state.protection ?? 'none'
    let draft: Draft = {
      ...found.draft,
      encrypt: protection.startsWith('encrypted') ? true : undefined,
      sign: protection.startsWith('signed') ? true : undefined
    }
    const infos = state.attachments ?? []
    if (infos.length > 0) {
      try {
        const brought = await bringAttachments(state.source, infos, this.services.files)
        const left = notBroughtText(brought)
        if (left) {
          // Not all of them are here: the copies that were made go, and the draft stays as it is on the server.
          await this.services.files.remove(brought.attachments.map((file) => file.path)).catch(() => undefined)
          this.store.showScreen({ ...state, notice: `Dieser Entwurf hat Anhänge, die sich nicht alle übernehmen lassen. ${left}` })
          return
        }
        draft = { ...draft, attachments: brought.attachments }
      } catch (error) {
        this.store.showScreen({ ...state, notice: `Die Anhänge des Entwurfs konnten nicht übernommen werden: ${explainError(error)}` })
        return
      }
    }
    this.show({
      account: state.account,
      returnTo: state,
      draft,
      fromDraft: state.folder,
      saved: { folder: state.folder, uid: state.summary.uid },
      savedDraft: draft
    })
  }

  /**
   * Puts the message into the queue, which sends it now when there is a connection and when there is one
   * again when there is not. An account that cannot send is told so before anything is queued: a message
   * that would fail five times in the queue has nobody looking at it.
   */
  async send(given: ComposeState, draft: Draft): Promise<void> {
    const state = await this.settled(given)
    const problem = senderProblem(state.account) ?? (await this.protectionProblemOf(state, draft))
    if (problem) {
      this.store.showScreen({ ...state, draft, error: problem })
      return
    }
    this.store.showScreen({ ...state, draft, busy: true, error: undefined })
    try {
      await this.services.mail.send(toComposeInput(state.account.id, draft))
      // The message is on its way, and a draft of it is not wanted any more: not the one that waits, and not the one kept.
      await this.services.mail.forgetDraft(state.account.id, state.session)
      await this.dropSavedRevision(state)
      await this.leave(state)
      this.navigator.refreshStatus()
    } catch (error) {
      this.store.showScreen({ ...state, draft, busy: false, error: explainError(error) })
    }
  }

  /**
   * Keeps the message as a draft on the server, in place of the revision kept before, and leaves. Without a connection
   * the draft waits in the queue and is kept when there is one, as the rest of what is decided does, so the message is not
   * lost by the phone being offline. The files that were attached stay until it is kept: the draft carries them.
   * A refusal that no connection would change, such as an account that has no folder for drafts, keeps the screen, with
   * the reason.
   */
  async saveDraft(given: ComposeState, draft: Draft): Promise<void> {
    const state = await this.settled(given)
    this.store.showScreen({ ...state, draft, busy: true, error: undefined })
    try {
      if ((await this.keepOnServer(state, draft)) === 'kept') {
        await this.services.files.remove(draft.attachments.map((attached) => attached.path)).catch(() => undefined)
      }
      await this.leave(state)
    } catch (error) {
      this.store.showScreen({ ...state, draft, busy: false, error: explainError(error) })
    }
  }

  /**
   * Leaves without sending, and keeps what was kept. What was attached was copied for this message, and goes with it,
   * unless a draft that waits for a connection carries it: that one needs the files until it is kept.
   */
  async cancel(state: ComposeState, draft: Draft): Promise<void> {
    const { waiting } = await this.services.mail.draftState(state.account.id, state.session)
    if (!waiting) await this.services.files.remove(draft.attachments.map((attached) => attached.path)).catch(() => undefined)
    this.keeping.delete(state.session)
    await this.leave(state)
  }

  /**
   * Throws the message away, as the desktop does: the draft that was kept of it, by hand or by itself, is deleted too,
   * and not left to turn up in the drafts of a message that nobody wants.
   */
  async discard(given: ComposeState, draft: Draft): Promise<void> {
    const state = await this.settled(given)
    await this.services.mail.forgetDraft(state.account.id, state.session)
    await this.dropSavedRevision(state)
    await this.cancel(state, draft)
  }

  /** Runs one thing at a time that keeps a draft, so that one that began later is never overtaken by one that began before. */
  private inflight: Promise<void> = Promise.resolve()

  /**
   * Keeps the message as a draft without anybody waiting for it, as the desktop does once writing pauses: in the
   * drafts folder, in place of the revision kept before. It says what it is doing in a line of the screen, and when it
   * cannot, because there is no connection or no folder for drafts, it says that and writes the message on: nothing
   * is lost that was not lost before, and the next pause tries again.
   */
  autosave(state: ComposeState, draft: Draft): Promise<void> {
    this.inflight = this.inflight.then(() => this.keep(state, draft))
    return this.inflight
  }

  private async keep(given: ComposeState, draft: Draft): Promise<void> {
    const state = this.latest(given)
    if (!autosaveDue(state, draft)) return
    this.mark(state, { autosave: { status: 'saving' } })
    try {
      // When it was kept at once the queue has said so already, and the screen has it. When it waits, that is what is said.
      if ((await this.keepOnServer(state, draft)) === 'waiting') this.mark(state, { savedDraft: draft, autosave: { status: 'waiting' } })
    } catch (error) {
      this.mark(state, { autosave: { status: 'failed', error: explainError(error) } })
    }
  }

  /**
   * Hands the draft to the queue, in place of the one that waits and of the revision kept before, and runs it when there is a
   * connection. Says whether it was kept or waits; raises why not when it was tried and failed, or cannot be, so that the
   * screen can say it, and the next pause or the next try is not a surprise.
   */
  private async keepOnServer(state: ComposeState, draft: Draft): Promise<'kept' | 'waiting'> {
    const { db, mail } = this.services
    if (!(await draftsFolderOf(db, state.account.id))) throw new Error('Dieses Konto hat keinen Ordner für Entwürfe.')
    // A draft that was meant to be encrypted is not kept in the clear, and says why it is not kept.
    const unprotected = await this.protectionProblemOf(state, draft, { draft: true })
    if (unprotected) throw new Error(unprotected)
    // A connection is made when there is none yet, as the account does for anything it is asked: only one that cannot be
    // made leaves the draft in the queue.
    await this.services.connections.ensure(state.account).catch(() => undefined)
    this.keeping.set(state.session, draft)
    const before = state.saved ? { folderId: state.saved.folder.id, uid: state.saved.uid } : undefined
    await mail.keepDraft(toComposeInput(state.account.id, draft), state.session, before)
    const after = await mail.draftState(state.account.id, state.session)
    if (!after.waiting) return 'kept'
    // Still there after the queue ran: it is waiting for a connection, unless an attempt was made, which failed.
    if (after.error !== null) throw new Error(after.error)
    return 'waiting'
  }

  /** Why the message cannot be signed or encrypted as asked, or null: before it is queued, where it can still be put right. */
  private protectionProblemOf(state: ComposeState, draft: Draft, options: { draft?: boolean } = {}): Promise<string | null> {
    return protectionProblem(
      this.services.db,
      state.account.id,
      { encrypt: draft.encrypt === true, sign: draft.sign === true },
      recipientAddresses(draft),
      options
    )
  }

  /** A message that is started, with signing and encrypting on where the user wants them for every message and the account can. */
  private started(account: Account, draft: Draft): Draft {
    return { ...draft, ...this.protection.forAccount(account.id) }
  }

  /** The state it was given with what has been kept since, which is on the screen while the writing of it is. */
  private latest(state: ComposeState): ComposeState {
    const shown = this.store.screen
    if (shown.name !== 'compose' || shown.session !== state.session) return state
    return { ...state, saved: shown.saved, savedDraft: shown.savedDraft, autosave: shown.autosave, noAutosave: shown.noAutosave }
  }

  /** Waits for what is being kept, and then gives the newest state, which says where the last revision is. */
  private async settled(state: ComposeState): Promise<ComposeState> {
    await this.inflight
    return this.latest(state)
  }

  /** Puts something on the screen of this writing of a message, when it is still the screen: not over another. */
  private mark(state: ComposeState, patch: Partial<ComposeState>): void {
    const shown = this.store.screen
    if (shown.name === 'compose' && shown.session === state.session) this.store.showScreen({ ...shown, ...patch })
  }

  /** The earlier revision of a draft is for good once the new one is kept or sent, as the desktop does it. */
  private async dropSavedRevision(state: ComposeState): Promise<void> {
    if (state.saved) await this.services.mail.remove(state.saved.folder, [state.saved.uid], { permanent: true })
  }

  /** Back to where the message was started, or to the drafts when it came from one, which show what was done to it. */
  private async leave(state: ComposeState): Promise<void> {
    if (state.fromDraft) await this.navigator.showMessages(state.account, state.fromDraft, { sync: true })
    else this.store.showScreen(state.returnTo)
  }

  private show(start: Pick<ComposeState, 'account' | 'returnTo' | 'draft' | 'fromDraft' | 'saved' | 'savedDraft' | 'error'>): void {
    this.store.showScreen({ name: 'compose', session: newId(), ...start, busy: false })
  }
}
