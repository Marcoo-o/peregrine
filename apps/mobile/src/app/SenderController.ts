import type { Account } from '../accounts'
import { explainError } from '../errors'
import { addIdentity, listIdentities, removeIdentity, setDefaultIdentity, updateIdentity } from '../identities'
import { looksLikeAddress } from './accountForm'
import type { Identities } from './Identities'
import type { Navigator } from './Navigator'
import type { IdentitiesState } from './screens'
import type { Services } from './services'
import type { AppStore } from './store'
import { t } from '../i18n'

/** What the form for an identity holds. */
export interface IdentityFields {
  displayName: string
  emailAddress: string
  signature: string
}

/** The addresses an account sends under, with the name and signature of each: made, changed, made the default and taken away. */
export class SenderController {
  constructor(
    private readonly services: Services,
    private readonly store: AppStore,
    private readonly navigator: Navigator,
    private readonly identities: Identities
  ) {}

  /** The identities of the account, with a line about what was just done when there is one. */
  async show(account: Account, notice?: string, error?: string): Promise<void> {
    this.store.showScreen({ name: 'identities', account, identities: await listIdentities(this.services.db, account.id), notice, error })
  }

  back(account: Account): Promise<void> {
    return this.navigator.showStoredFolders(account)
  }

  /** Keeps what the form holds: a new identity when `id` is null, and else the change of that one. */
  async save(state: IdentitiesState, id: string | null, fields: IdentityFields): Promise<void> {
    const emailAddress = fields.emailAddress.trim()
    if (!looksLikeAddress(emailAddress)) {
      await this.show(state.account, undefined, t('Das ist keine E-Mail-Adresse.'))
      return
    }
    try {
      const kept = { displayName: fields.displayName.trim(), emailAddress, signature: fields.signature.replace(/\r\n?/g, '\n').trim() }
      if (id === null) await addIdentity(this.services.db, { accountId: state.account.id, ...kept })
      else await updateIdentity(this.services.db, id, kept)
      await this.identities.load()
      await this.show(state.account, t('Gespeichert.'))
    } catch (error) {
      await this.show(state.account, undefined, explainError(error))
    }
  }

  /** Makes the identity the one a new message starts from. */
  async makeDefault(state: IdentitiesState, id: string): Promise<void> {
    await setDefaultIdentity(this.services.db, id)
    await this.identities.load()
    await this.show(state.account, t('Neue Nachrichten beginnen jetzt mit diesem Absender.'))
  }

  /** Takes an identity away, unless it is the last, which the account needs to send. */
  async remove(state: IdentitiesState, id: string): Promise<void> {
    if (!(await removeIdentity(this.services.db, id))) {
      await this.show(state.account, undefined, t('Das ist der einzige Absender des Kontos. Ohne einen lässt sich nicht senden.'))
      return
    }
    await this.identities.load()
    await this.show(state.account, t('Der Absender ist entfernt.'))
  }
}
