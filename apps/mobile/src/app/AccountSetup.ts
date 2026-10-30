import { addAccount, removeAccount, updateAccount, type Account } from '../accounts'
import { applyPush, forgetPush } from '../background/push'
import { explainError } from '../errors'
import { findServers, type FoundServers } from '../discovery'
import { smtpSettingsOf } from '../send'
import { connectionsChanged, imapLoginOf, newAccountFrom, patchFromEdit, type AccountForm, type EditFields } from './accountForm'
import type { Navigator } from './Navigator'
import type { Services } from './services'
import type { AppStore } from './store'

/** Adding an account, changing one, and removing one. */
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
      const kept = newAccountFrom(form)
      // The login for sending is tried as well, before anything is kept: a wrong one would be found when the first message does not go.
      const sending = smtpSettingsOf(kept)
      if (sending) {
        try {
          await this.services.checkSending(sending)
        } catch (error) {
          await session.disconnect().catch(() => undefined)
          this.store.showScreen({ name: 'login', error: `Zum Senden: ${explainError(error)}` })
          return
        }
      }
      const account = await addAccount(this.services.db, kept)
      this.services.connections.adopt(account.id, session)
      await applyPush(this.services)
      await this.navigator.showFolders(account, session)
    } catch (error) {
      this.store.showScreen({ name: 'login', error: explainError(error) })
    }
  }

  /** How the servers of an address are found. It is a field so that it can be another in a test, which has no internet. */
  find: (email: string) => Promise<FoundServers | null> = (email) => findServers(email)

  /** The screen for changing an account. */
  startEdit(account: Account): void {
    this.store.showScreen({ name: 'editAccount', account })
  }

  /**
   * Keeps what was changed of an account, once what changed has been tried: the login for reading when the way in or the password changed, the
   * login for sending when that did. A change that does not work leaves the account as it was, with the reason, and the form as it was typed. The
   * connection that proved a new login is the account's from then on, and the system's push is told of the new login.
   */
  async save(account: Account, fields: EditFields): Promise<void> {
    this.store.showScreen({ name: 'editAccount', account, busy: true })
    const patch = patchFromEdit(account, fields)
    const next: Account = { ...account, ...patch }
    const { reading, sending } = connectionsChanged(account, next)
    const fail = (error: string) => this.store.showScreen({ name: 'editAccount', account, error })
    let session
    if (reading) {
      try {
        session = await this.services.connectImap(imapLoginOf(next))
      } catch (error) {
        fail(`Zum Lesen: ${explainError(error)}`)
        return
      }
    }
    const settings = smtpSettingsOf(next)
    if (sending && settings) {
      try {
        await this.services.checkSending(settings)
      } catch (error) {
        await session?.disconnect().catch(() => undefined)
        fail(`Zum Senden: ${explainError(error)}`)
        return
      }
    }
    const saved = (await updateAccount(this.services.db, account.id, patch)) ?? next
    if (session) this.services.connections.adopt(saved.id, session)
    if (reading || sending) await applyPush(this.services)
    if (session) await this.navigator.showFolders(saved, session)
    else await this.navigator.openAccount(saved)
  }

  /** Removes an account with its mail and its queue and the files its queue carried, and lets go of its connection. */
  async remove(account: Account): Promise<void> {
    this.services.connections.drop(account.id)
    await forgetPush(this.services, account.id)
    await removeAccount(this.services.db, account.id)
    await this.services.sweepCopies()
    await this.navigator.showAccounts()
  }
}
