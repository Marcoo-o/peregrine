import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Plus, Trash2 } from 'lucide-react'
import type { Identity } from '@peregrine/core/types'
import { toastError, toastInfo } from '@renderer/state/toastStore'

interface IdentitiesEditorProps {
  accountId: string
}

/**
 * Sender addresses of one account.
 *
 * All of them send over the same server; what changes is only the From line. Providers accept
 * that for addresses that belong to the mailbox, which is exactly what an alias is, and
 * reject it for anything else, so nothing here needs to check: the server decides.
 */
function IdentitiesEditor({ accountId }: IdentitiesEditorProps): JSX.Element {
  const { t } = useTranslation()
  const [identities, setIdentities] = useState<Identity[]>([])
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [signature, setSignature] = useState('')

  async function reload(): Promise<void> {
    setIdentities(await window.peregrine.identities.list(accountId))
  }

  useEffect(() => {
    void reload()
  }, [accountId])

  async function handleAdd(): Promise<void> {
    if (!email.includes('@')) return
    try {
      await window.peregrine.identities.create({
        accountId,
        displayName: name.trim(),
        emailAddress: email.trim(),
        signature
      })
      setName('')
      setEmail('')
      setSignature('')
      setAdding(false)
      await reload()
    } catch (err) {
      toastError(err, t('settings.identityAddFailed'))
    }
  }

  async function handleDelete(identity: Identity): Promise<void> {
    if (!window.confirm(t('settings.confirmRemoveIdentity', { address: identity.emailAddress }))) {
      return
    }
    const { removed } = await window.peregrine.identities.delete(identity.id)
    // The last identity of an account is kept: without one the account could not send at all.
    if (!removed) toastInfo(t('settings.identityLastKept'))
    await reload()
  }

  return (
    <div className="settings-field">
      {t('settings.identities')}
      <span className="settings-hint">{t('settings.identitiesHint')}</span>

      <ul className="identity-list">
        {identities.map((identity) => (
          <li key={identity.id} className="identity-row">
            <div className="identity-info">
              <span className="settings-account-name">
                {identity.displayName || identity.emailAddress}
              </span>
              <span className="settings-account-email">{identity.emailAddress}</span>
            </div>

            {identity.isDefault ? (
              <span className="identity-default" title={t('settings.identityDefault')}>
                <Check size={13} strokeWidth={2} />
                {t('settings.identityDefault')}
              </span>
            ) : (
              <button
                onClick={async () => {
                  await window.peregrine.identities.setDefault(identity.id)
                  await reload()
                }}
              >
                {t('settings.identityMakeDefault')}
              </button>
            )}

            <button
              className="icon-button"
              aria-label={t('settings.identityRemove')}
              title={t('settings.identityRemove')}
              onClick={() => void handleDelete(identity)}
            >
              <Trash2 size={14} strokeWidth={1.75} />
            </button>
          </li>
        ))}
      </ul>

      {adding ? (
        <div className="identity-form">
          <input
            autoFocus
            placeholder={t('settings.identityName')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            type="email"
            placeholder={t('settings.identityEmail')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <textarea
            rows={3}
            placeholder={t('settings.identitySignature')}
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
          />
          <div className="settings-inline-row">
            <button onClick={() => setAdding(false)}>{t('compose.cancel')}</button>
            <button
              className="primary-button"
              disabled={!email.includes('@')}
              onClick={() => void handleAdd()}
            >
              {t('settings.identityAdd')}
            </button>
          </div>
        </div>
      ) : (
        <div className="settings-inline-row">
          <button onClick={() => setAdding(true)}>
            <Plus size={14} strokeWidth={1.75} />
            {t('settings.identityAdd')}
          </button>
        </div>
      )}
    </div>
  )
}

export default IdentitiesEditor
