import { addAccount, removeAccount, type Account } from '../accounts'
import { explainError } from '../errors'
import { newAccountFrom, type AccountForm } from './accountForm'
import type { Navigator } from './Navigator'
import type { Services } from './services'
import type { AppStore } from './store'

/** Adding an account and removing one. */
export class AccountSetup {
  /** What was typed last, so that a failed sign-in does not make anybody type it all again. */
  lastAttempt: AccountForm | undefined

  constructor(
    private readonly services: Services,
    private readonly store: AppStore,
    private readonly navigator: Navigator
  ) {}

  /**
   * Connects with what was typed and keeps the account only once that worked: a mistyped server would
   * otherwise be tried again at every start. The connection that proved the login is the account's.
   */
  async signIn(form: AccountForm): Promise<void> {
    this.lastAttempt = form
    this.store.showScreen({ name: 'loading' })
    try {
      const session = await this.services.connectImap(form)
      const account = await addAccount(this.services.db, newAccountFrom(form))
      this.services.connections.adopt(account.id, session)
      await this.navigator.showFolders(account, session)
    } catch (error) {
      this.store.showScreen({ name: 'login', error: explainError(error) })
    }
  }

  /** Removes an account with its mail and its queue, and lets go of its connection. */
  async remove(account: Account): Promise<void> {
    this.services.connections.drop(account.id)
    await removeAccount(this.services.db, account.id)
    await this.navigator.showAccounts()
  }
}
