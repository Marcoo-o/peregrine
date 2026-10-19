import { errorText } from '@renderer/util/errorText'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ACCOUNT_COLORS } from '@peregrine/core/accountColors'
import { ArrowLeft, Save } from 'lucide-react'
import IdentitiesEditor from './IdentitiesEditor'
import type { AccountSummary, SecureMode } from '@peregrine/core/types'

interface AccountEditorProps {
  account: AccountSummary
  onDone: () => void
}

function AccountEditor({ account, onDone }: AccountEditorProps): JSX.Element {
  const { t } = useTranslation()
  const [displayName, setDisplayName] = useState(account.displayName)
  const [signature, setSignature] = useState(account.signature)
  const [color, setColor] = useState(account.color)
  const [encryptByDefault, setEncryptByDefault] = useState(account.encryptByDefault)
  const [imapHost, setImapHost] = useState(account.imapHost)
  const [imapPort, setImapPort] = useState(account.imapPort)
  const [imapSecure, setImapSecure] = useState<SecureMode>(account.imapSecure)
  const [imapUsername, setImapUsername] = useState(account.imapUsername)
  const [imapPassword, setImapPassword] = useState('')
  const [smtpHost, setSmtpHost] = useState(account.smtpHost)
  const [smtpPort, setSmtpPort] = useState(account.smtpPort)
  const [smtpSecure, setSmtpSecure] = useState<SecureMode>(account.smtpSecure)
  const [smtpUsername, setSmtpUsername] = useState(account.smtpUsername)
  const [smtpPassword, setSmtpPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave(): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      await window.peregrine.accounts.update({
        accountId: account.id,
        displayName,
        signature,
        color,
        encryptByDefault,
        imapHost,
        imapPort,
        imapSecure,
        imapUsername,
        smtpHost,
        smtpPort,
        smtpSecure,
        smtpUsername,
        // Blank fields mean "keep the stored password". Never send empty strings through.
        imapPassword: imapPassword || undefined,
        smtpPassword: smtpPassword || undefined
      })
      onDone()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="settings-header">
        <button onClick={onDone}>
          <ArrowLeft size={15} strokeWidth={1.75} />
          {t('settings.back')}
        </button>
        <h2>{account.emailAddress}</h2>
      </div>

      <section className="settings-section">
        <h3>{t('settings.identity')}</h3>
        <label className="settings-field">
          {t('wizard.displayName')}
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <label className="settings-field">
          {t('settings.signature')}
          <textarea rows={4} value={signature} onChange={(e) => setSignature(e.target.value)} />
        </label>
        <IdentitiesEditor accountId={account.id} />

        <label className="settings-field">
          {t('settings.accountColor')}
          <div className="accent-swatches">
            {ACCOUNT_COLORS.map((option) => (
              <button
                key={option}
                className={color === option ? 'accent-swatch active' : 'accent-swatch'}
                style={{ background: option }}
                aria-label={option}
                onClick={() => setColor(option)}
              />
            ))}
          </div>
        </label>
        <label className="compose-encrypt-toggle">
          <input
            type="checkbox"
            checked={encryptByDefault}
            onChange={(e) => setEncryptByDefault(e.target.checked)}
          />
          {t('settings.encryptByDefault')}
        </label>
      </section>

      <section className="settings-section">
        <h3>{t('wizard.imapSection')}</h3>
        <label className="settings-field">
          {t('wizard.host')}
          <input value={imapHost} onChange={(e) => setImapHost(e.target.value)} />
        </label>
        <label className="settings-field">
          {t('wizard.port')}
          <input type="number" value={imapPort} onChange={(e) => setImapPort(Number(e.target.value))} />
        </label>
        <label className="settings-field">
          {t('wizard.security')}
          <select value={imapSecure} onChange={(e) => setImapSecure(e.target.value as SecureMode)}>
            <option value="tls">TLS</option>
            <option value="starttls">STARTTLS</option>
            <option value="none">{t('wizard.none')}</option>
          </select>
        </label>
        <label className="settings-field">
          {t('wizard.username')}
          <input value={imapUsername} onChange={(e) => setImapUsername(e.target.value)} />
        </label>
        <label className="settings-field">
          {t('settings.newPasswordOptional')}
          <input
            type="password"
            value={imapPassword}
            placeholder="••••••••"
            onChange={(e) => setImapPassword(e.target.value)}
          />
        </label>
      </section>

      <section className="settings-section">
        <h3>{t('wizard.smtpSection')}</h3>
        <label className="settings-field">
          {t('wizard.host')}
          <input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} />
        </label>
        <label className="settings-field">
          {t('wizard.port')}
          <input type="number" value={smtpPort} onChange={(e) => setSmtpPort(Number(e.target.value))} />
        </label>
        <label className="settings-field">
          {t('wizard.security')}
          <select value={smtpSecure} onChange={(e) => setSmtpSecure(e.target.value as SecureMode)}>
            <option value="tls">TLS</option>
            <option value="starttls">STARTTLS</option>
            <option value="none">{t('wizard.none')}</option>
          </select>
        </label>
        <label className="settings-field">
          {t('wizard.username')}
          <input value={smtpUsername} onChange={(e) => setSmtpUsername(e.target.value)} />
        </label>
        <label className="settings-field">
          {t('settings.newPasswordOptional')}
          <input
            type="password"
            value={smtpPassword}
            placeholder="••••••••"
            onChange={(e) => setSmtpPassword(e.target.value)}
          />
        </label>
      </section>

      {error && <p className="wizard-error">{error}</p>}

      <div className="wizard-actions">
        <button onClick={handleSave} disabled={saving}>
          <Save size={15} strokeWidth={1.75} />
          {saving ? t('settings.saving') : t('settings.save')}
        </button>
      </div>
    </>
  )
}

export default AccountEditor
