import type { Account } from '../accounts'
import { emptyDraft, replyDraft, toComposeInput, type Draft } from '../draft'
import { describeError } from '../errors'
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

  /** An answer to the open message, once its text is there to quote. */
  startReply(state: MessageState): void {
    if (!state.message) return
    this.show({ account: state.account, returnTo: state, draft: replyDraft(state.message) })
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
      this.store.showScreen(state.returnTo)
      this.navigator.refreshStatus()
    } catch (error) {
      this.store.showScreen({ ...state, draft, busy: false, error: describeError(error) })
    }
  }

  /** Leaves without sending. What was attached was copied for this message, and goes with it. */
  async cancel(state: ComposeState, draft: Draft): Promise<void> {
    const copies = draft.attachments.map((attached) => attached.path)
    await this.services.files.remove(copies).catch(() => undefined)
    this.store.showScreen(state.returnTo)
  }

  private show(start: { account: Account; returnTo: Screen; draft: Draft }): void {
    this.store.showScreen({ name: 'compose', ...start, busy: false })
  }
}
