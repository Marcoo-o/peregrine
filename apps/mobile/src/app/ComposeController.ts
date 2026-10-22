import { listAccounts, type Account } from '../accounts'
import { suggestContacts, type Contact } from '../contacts'
import { editableDraft, emptyDraft, forwardDraft, replyAllDraft, replyDraft, toComposeInput, type Draft } from '../draft'
import { saveDraft } from '../drafts'
import { explainError } from '../errors'
import { smtpSettingsOf } from '../send'
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
  constructor(
    private readonly services: Services,
    private readonly store: AppStore,
    private readonly navigator: Navigator
  ) {}

  /** An empty message from an account, and the screen to show again when it is done with. */
  startNew(account: Account, returnTo: Screen): void {
    this.show({ account, returnTo, draft: emptyDraft })
  }

  /**
   * An empty message from the first account, for the places that are not an account's: the list of all inboxes, a
   * search. The account it is written from can be another one that the user has, and is told on the screen.
   */
  async startNewFromAnyAccount(returnTo: Screen): Promise<void> {
    const [first] = await listAccounts(this.services.db)
    if (first) this.startNew(first, returnTo)
  }

  /** The people to suggest for an address that is being typed: those the phone has mail from, without the user's own. */
  async suggest(typed: string): Promise<Contact[]> {
    const accounts = await listAccounts(this.services.db)
    return suggestContacts(this.services.db, typed, accounts.map((account) => account.emailAddress))
  }

  /** An answer to the open message, once its text is there to quote. */
  startReply(state: MessageState): void {
    if (!state.message) return
    this.show({ account: state.account, returnTo: state, draft: replyDraft(state.message) })
  }

  /** An answer to everybody the open message went to. */
  startReplyAll(state: MessageState): void {
    if (!state.message) return
    this.show({ account: state.account, returnTo: state, draft: replyAllDraft(state.message, state.account.emailAddress) })
  }

  /** The open message, to be passed on to somebody. */
  startForward(state: MessageState): void {
    if (!state.message) return
    this.show({ account: state.account, returnTo: state, draft: forwardDraft(state.message) })
  }

  /**
   * A message kept as a draft, to be written on. Opened only when saving it again would keep all of it: the reason
   * it cannot be is said on the message, where the user asked for it.
   */
  startFromDraft(state: MessageState): void {
    if (!state.message) return
    const found = editableDraft(state.message, state.attachments?.length ?? 0)
    if ('refusal' in found) {
      this.store.showScreen({ ...state, notice: found.refusal })
      return
    }
    this.show({
      account: state.account,
      returnTo: state,
      draft: found.draft,
      saved: { folder: state.folder, uid: state.summary.uid }
    })
  }

  /**
   * Puts the message into the queue, which sends it now when there is a connection and when there is one
   * again when there is not. An account that cannot send is told so before anything is queued: a message
   * that would fail five times in the queue has nobody looking at it.
   */
  async send(state: ComposeState, draft: Draft): Promise<void> {
    const problem = senderProblem(state.account)
    if (problem) {
      this.store.showScreen({ ...state, draft, error: problem })
      return
    }
    this.store.showScreen({ ...state, draft, busy: true, error: undefined })
    try {
      await this.services.mail.send(toComposeInput(state.account.id, draft))
      await this.dropSavedRevision(state)
      await this.leave(state)
      this.navigator.refreshStatus()
    } catch (error) {
      this.store.showScreen({ ...state, draft, busy: false, error: explainError(error) })
    }
  }

  /**
   * Keeps the message as a draft on the server, in place of the revision it was opened from, and leaves. It needs a
   * connection, which it does not wait for: a draft that is only half kept is worse than one that was not, so the
   * screen stays, with the reason, and the message is still there to send or to give up.
   */
  async saveDraft(state: ComposeState, draft: Draft): Promise<void> {
    this.store.showScreen({ ...state, draft, busy: true, error: undefined })
    try {
      const imap = await this.services.connections.ensure(state.account)
      const input = toComposeInput(state.account.id, draft)
      await saveDraft(this.services.db, this.services.files, imap, input)
      await this.dropSavedRevision(state)
      await this.services.files.remove(draft.attachments.map((attached) => attached.path)).catch(() => undefined)
      await this.leave(state)
    } catch (error) {
      this.store.showScreen({ ...state, draft, busy: false, error: explainError(error) })
    }
  }

  /** Leaves without sending. What was attached was copied for this message, and goes with it. */
  async cancel(state: ComposeState, draft: Draft): Promise<void> {
    const copies = draft.attachments.map((attached) => attached.path)
    await this.services.files.remove(copies).catch(() => undefined)
    await this.leave(state)
  }

  /** The earlier revision of a draft is for good once the new one is kept or sent, as the desktop does it. */
  private async dropSavedRevision(state: ComposeState): Promise<void> {
    if (state.saved) await this.services.mail.remove(state.saved.folder, [state.saved.uid], { permanent: true })
  }

  /** Back to where the message was started, or to the drafts when it came from one, which show what was done to it. */
  private async leave(state: ComposeState): Promise<void> {
    if (state.saved) await this.navigator.showMessages(state.account, state.saved.folder, { sync: true })
    else this.store.showScreen(state.returnTo)
  }

  private show(start: { account: Account; returnTo: Screen; draft: Draft; saved?: ComposeState['saved'] }): void {
    this.store.showScreen({ name: 'compose', ...start, busy: false })
  }
}
