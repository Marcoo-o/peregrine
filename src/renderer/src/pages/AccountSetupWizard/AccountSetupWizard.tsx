import { errorText } from '@renderer/util/errorText'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, CheckCircle2, Plug, Search, UserPlus, X, XCircle } from 'lucide-react'
import type { DiscoverySource, SecureMode } from '@peregrine/core/types'
import { findPresetForEmail, type ProviderPreset } from './providerPresets'
import ProviderPicker from './ProviderPicker'

interface AccountSetupWizardProps {
  onCreated: () => void
  onCancel: () => void
}

interface FormState {
  displayName: string
  emailAddress: string
  imapHost: string
  imapPort: number
  imapSecure: SecureMode
  imapUsername: string
  imapPassword: string
  smtpHost: string
  smtpPort: number
  smtpSecure: SecureMode
  smtpUsername: string
  smtpPassword: string
}

const emptyForm: FormState = {
  displayName: '',
  emailAddress: '',
  imapHost: '',
  imapPort: 993,
  imapSecure: 'tls',
  imapUsername: '',
  imapPassword: '',
  smtpHost: '',
  smtpPort: 587,
  smtpSecure: 'starttls',
  smtpUsername: '',
  smtpPassword: ''
}

function AccountSetupWizard({ onCreated, onCancel }: AccountSetupWizardProps): JSX.Element {
  const { t } = useTranslation()
  const [form, setForm] = useState<FormState>(emptyForm)
  const [testResult, setTestResult] = useState<{ imapOk: boolean; smtpOk: boolean } | null>(null)
  const [testing, setTesting] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [discovering, setDiscovering] = useState(false)
  /** The address the fields were filled from, so the lookup runs once per address. */
  const [discoveredFor, setDiscoveredFor] = useState('')
  /** Where the filled-in settings came from, or why there are none. */
  const [discovery, setDiscovery] = useState<DiscoverySource | 'preset' | 'none' | 'oauth2' | null>(
    null
  )
  /** The provider tile the user picked, 'manual' for the full form, or null for the picker screen. */
  const [pickedProvider, setPickedProvider] = useState<ProviderPreset | 'manual' | null>(null)
  const knownPreset = pickedProvider !== 'manual' ? pickedProvider : null
  const appPasswordUrl = knownPreset?.appPasswordUrl

  function update<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }))
    setTestResult(null)
  }

  /**
   * The picked-provider form asks for an address and a password, not for four of each.
   * Both servers of a consumer mailbox take the same login, so one field feeds both.
   */
  function updateEmailSimple(email: string): void {
    setForm((prev) => ({ ...prev, emailAddress: email, imapUsername: email, smtpUsername: email }))
    setTestResult(null)
  }

  function updatePasswordSimple(password: string): void {
    setForm((prev) => ({ ...prev, imapPassword: password, smtpPassword: password }))
    setTestResult(null)
  }

  function handlePick(preset: ProviderPreset): void {
    setForm((prev) => ({
      ...prev,
      imapHost: preset.imapHost,
      imapPort: preset.imapPort,
      imapSecure: preset.imapSecure,
      smtpHost: preset.smtpHost,
      smtpPort: preset.smtpPort,
      smtpSecure: preset.smtpSecure
    }))
    setPickedProvider(preset)
  }

  function handleBack(): void {
    setPickedProvider(null)
    setForm(emptyForm)
    setTestResult(null)
    setError(null)
    setDiscovery(null)
    setDiscoveredFor('')
  }

  /** Fills the server fields from a local preset; the fallback when nothing is published. */
  function applyPreset(): boolean {
    const preset = findPresetForEmail(form.emailAddress)
    if (!preset) return false
    setForm((prev) => ({
      ...prev,
      imapHost: preset.imapHost,
      imapPort: preset.imapPort,
      imapSecure: preset.imapSecure,
      imapUsername: prev.imapUsername || prev.emailAddress,
      smtpHost: preset.smtpHost,
      smtpPort: preset.smtpPort,
      smtpSecure: preset.smtpSecure,
      smtpUsername: prev.smtpUsername || prev.emailAddress
    }))
    return true
  }

  /**
   * Asks the provider, and failing that the public database, what its servers are.
   *
   * Runs on leaving the address field rather than behind a button: at that moment the user
   * has just typed the one thing the lookup needs, and finding six fields already filled in
   * is a better answer than a button asking them to try.
   *
   * The local presets stay as the last resort. They cover the four large providers and cost
   * no network at all, but they are a list that ages; anything published wins over them.
   */
  async function handleEmailBlur(): Promise<void> {
    const email = form.emailAddress.trim()
    // Once per address, not once per account: a typo corrected in this field has to lead to
    // a fresh lookup, and merely leaving the field again must not.
    if (!email.includes('@') || discoveredFor === email) return
    setDiscoveredFor(email)

    setDiscovering(true)
    setDiscovery(null)
    try {
      const result = await window.peregrine.accounts.discover({ email })
      if (result.found) {
        const { config, source } = result
        // Not the display name: the one in the document is the provider's own ("mailbox.org
        // -- damit Privates privat bleibt"), while the field asks for the user's name.
        setForm((prev) => ({
          ...prev,
          imapHost: config.imap.host,
          imapPort: config.imap.port,
          imapSecure: config.imap.secure,
          imapUsername: config.imap.username,
          smtpHost: config.smtp.host,
          smtpPort: config.smtp.port,
          smtpSecure: config.smtp.secure,
          smtpUsername: config.smtp.username
        }))
        // OAuth2 is not something this application can do yet, and a password field that
        // cannot work is worse than a sentence saying so.
        setDiscovery(config.imap.authType === 'oauth2' ? 'oauth2' : source)
        return
      }
      setDiscovery(applyPreset() ? 'preset' : 'none')
    } catch {
      setDiscovery(applyPreset() ? 'preset' : 'none')
    } finally {
      setDiscovering(false)
    }
  }

  async function handleTestConnection(): Promise<void> {
    setTesting(true)
    setError(null)
    try {
      const result = await window.peregrine.accounts.testConnection({
        imapHost: form.imapHost,
        imapPort: form.imapPort,
        imapSecure: form.imapSecure,
        imapUsername: form.imapUsername,
        imapPassword: form.imapPassword,
        smtpHost: form.smtpHost,
        smtpPort: form.smtpPort,
        smtpSecure: form.smtpSecure,
        smtpUsername: form.smtpUsername,
        smtpPassword: form.smtpPassword
      })
      setTestResult(result)
      if (!result.imapOk) setError(result.imapError ?? null)
      else if (!result.smtpOk) setError(result.smtpError ?? null)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setTesting(false)
    }
  }

  async function handleCreate(): Promise<void> {
    setCreating(true)
    setError(null)
    try {
      await window.peregrine.accounts.create(form)
      onCreated()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setCreating(false)
    }
  }

  const canCreate = testResult?.imapOk && testResult?.smtpOk

  if (pickedProvider === null) {
    return <ProviderPicker onPick={handlePick} onManual={() => setPickedProvider('manual')} />
  }

  return (
    <div className="account-wizard">
      <button type="button" className="link-button wizard-back" onClick={handleBack}>
        <ArrowLeft size={14} strokeWidth={1.75} />
        {t('wizard.back')}
      </button>
      <h2>{t('wizard.title')}</h2>

      <label>
        {t('wizard.displayName')}
        <input value={form.displayName} onChange={(e) => update('displayName', e.target.value)} />
      </label>

      <label>
        {t('wizard.email')}
        <input
          value={form.emailAddress}
          onChange={(e) =>
            knownPreset ? updateEmailSimple(e.target.value) : update('emailAddress', e.target.value)
          }
          onBlur={knownPreset ? undefined : () => void handleEmailBlur()}
        />
      </label>

      {!knownPreset && discovering && (
        <p className="wizard-discovery">
          <Search size={14} strokeWidth={1.75} />
          {t('wizard.discovering')}
        </p>
      )}
      {!knownPreset && !discovering && discovery && (
        <p
          className={`wizard-discovery${discovery === 'none' || discovery === 'oauth2' ? ' warn' : ''}`}
        >
          {discovery === 'none' || discovery === 'oauth2' ? (
            <XCircle size={14} strokeWidth={1.75} />
          ) : (
            <CheckCircle2 size={14} strokeWidth={1.75} />
          )}
          {t(`wizard.discovery.${discovery}`)}
        </p>
      )}

      {knownPreset && (
        <>
          <label>
            {t('wizard.appPassword')}
            <input
              type="password"
              value={form.imapPassword}
              onChange={(e) => updatePasswordSimple(e.target.value)}
            />
          </label>
          {appPasswordUrl && (
            <p className="wizard-hint">
              {t('wizard.appPasswordHint', { provider: knownPreset.label })}{' '}
              <button
                type="button"
                className="link-button"
                onClick={() => void window.peregrine.links.openExternal(appPasswordUrl)}
              >
                {t('wizard.openAppPasswordPage')}
              </button>
            </p>
          )}
          {knownPreset.id === 'outlook' && (
            <p className="wizard-hint warn">{t('wizard.outlookBusinessWarning')}</p>
          )}
        </>
      )}

      {!knownPreset && (
        <>
          <fieldset>
            <legend>{t('wizard.imapSection')}</legend>
            <label>
              {t('wizard.host')}
              <input value={form.imapHost} onChange={(e) => update('imapHost', e.target.value)} />
            </label>
            <label>
              {t('wizard.port')}
              <input
                type="number"
                value={form.imapPort}
                onChange={(e) => update('imapPort', Number(e.target.value))}
              />
            </label>
            <label>
              {t('wizard.security')}
              <select
                value={form.imapSecure}
                onChange={(e) => update('imapSecure', e.target.value as SecureMode)}
              >
                <option value="tls">TLS</option>
                <option value="starttls">STARTTLS</option>
                <option value="none">{t('wizard.none')}</option>
              </select>
            </label>
            <label>
              {t('wizard.username')}
              <input
                value={form.imapUsername}
                onChange={(e) => update('imapUsername', e.target.value)}
              />
            </label>
            <label>
              {t('wizard.password')}
              <input
                type="password"
                value={form.imapPassword}
                onChange={(e) => update('imapPassword', e.target.value)}
              />
            </label>
          </fieldset>

          <fieldset>
            <legend>{t('wizard.smtpSection')}</legend>
            <label>
              {t('wizard.host')}
              <input value={form.smtpHost} onChange={(e) => update('smtpHost', e.target.value)} />
            </label>
            <label>
              {t('wizard.port')}
              <input
                type="number"
                value={form.smtpPort}
                onChange={(e) => update('smtpPort', Number(e.target.value))}
              />
            </label>
            <label>
              {t('wizard.security')}
              <select
                value={form.smtpSecure}
                onChange={(e) => update('smtpSecure', e.target.value as SecureMode)}
              >
                <option value="tls">TLS</option>
                <option value="starttls">STARTTLS</option>
                <option value="none">{t('wizard.none')}</option>
              </select>
            </label>
            <label>
              {t('wizard.username')}
              <input
                value={form.smtpUsername}
                onChange={(e) => update('smtpUsername', e.target.value)}
              />
            </label>
            <label>
              {t('wizard.password')}
              <input
                type="password"
                value={form.smtpPassword}
                onChange={(e) => update('smtpPassword', e.target.value)}
              />
            </label>
          </fieldset>
        </>
      )}

      {testResult && (
        <p className={testResult.imapOk && testResult.smtpOk ? 'test-ok' : 'test-fail'}>
          {testResult.imapOk ? <CheckCircle2 size={14} /> : <XCircle size={14} />} IMAP ·{' '}
          {testResult.smtpOk ? <CheckCircle2 size={14} /> : <XCircle size={14} />} SMTP
        </p>
      )}
      {error && <p className="wizard-error">{error}</p>}

      <div className="wizard-actions">
        <button onClick={onCancel} disabled={testing || creating}>
          <X size={15} strokeWidth={1.75} />
          {t('wizard.cancel')}
        </button>
        <button onClick={handleTestConnection} disabled={testing || creating}>
          <Plug size={15} strokeWidth={1.75} />
          {testing ? t('wizard.testing') : t('wizard.testConnection')}
        </button>
        <button onClick={handleCreate} disabled={!canCreate || creating}>
          <UserPlus size={15} strokeWidth={1.75} />
          {creating ? t('wizard.creating') : t('wizard.create')}
        </button>
      </div>
    </div>
  )
}

export default AccountSetupWizard
