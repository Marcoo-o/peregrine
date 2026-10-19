import { errorText } from '@renderer/util/errorText'
import { parseErrorCode } from '@peregrine/core/errorText'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Download, KeyRound, Trash2, Upload, UploadCloud } from 'lucide-react'
import type { AccountKeyInfo, AccountSummary, PgpKeyInfo } from '@peregrine/core/types'
import { daysUntilExpiry, keyHealth, needsAttention } from '@peregrine/core/keyHealth'
import { useSettingsStore } from '@renderer/state/settingsStore'
import { askForText } from '@renderer/state/promptStore'

interface PgpSectionProps {
  account: AccountSummary
  /** Bumped after a key import, so this view does not keep showing the state from before it. */
  refreshToken?: number
}

function PgpSection({ account, refreshToken = 0 }: PgpSectionProps): JSX.Element {
  const { t } = useTranslation()
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.update)
  const [keyInfo, setKeyInfo] = useState<PgpKeyInfo | null>(null)
  /** The whole ring: the active key plus the retired ones that still open old mail. */
  const [keys, setKeys] = useState<AccountKeyInfo[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function reloadKeys(): Promise<void> {
    const [info, ring] = await Promise.all([
      window.peregrine.pgp.getKeyInfo(account.id),
      window.peregrine.pgp.listAccountKeys({ accountId: account.id })
    ])
    setKeyInfo(info)
    setKeys(ring)
  }

  useEffect(() => {
    void reloadKeys()
    setNotice(null)
    setError(null)
  }, [account.id, refreshToken])

  async function run(label: string, action: () => Promise<void>): Promise<void> {
    setBusy(label)
    setError(null)
    setNotice(null)
    try {
      await action()
    } catch (err) {
      // This used to unwrap the four unlock codes here, with a list of its own and a
      // `split(': ')` that a message containing a colon would have broken. Both now live in
      // one place, so every other dialog gets the same treatment without repeating it.
      setError(errorText(err))
    } finally {
      setBusy(null)
    }
  }

  function handleGenerate(): void {
    void run('generate', async () => {
      const info = await window.peregrine.pgp.generateKeyPair({
        accountId: account.id,
        name: account.displayName || account.emailAddress,
        email: account.emailAddress
      })
      setKeyInfo(info)
    })
  }

  /**
   * Pasting one key pair in.
   *
   * The passphrase is asked for only once the key turns out to need one. Most do not, and a
   * password prompt that appears every time teaches people to dismiss it unread.
   */
  async function handleImport(): Promise<void> {
    const armored = await askForText({
      title: t('settings.pgpPasteKeyPair'),
      multiline: true,
      placeholder: '-----BEGIN PGP PRIVATE KEY BLOCK-----'
    })
    if (!armored) return

    await run('import', async () => {
      let passphrase = ''
      for (;;) {
        try {
          setKeyInfo(
            await window.peregrine.pgp.importKeyPair({
              accountId: account.id,
              privateKeyArmored: armored,
              passphrase
            })
          )
          return
        } catch (err) {
          // This one wants the code, not the sentence: it decides whether to ask again.
          const reason = parseErrorCode(err)?.code
          if (reason !== 'passphraseRequired' && reason !== 'wrongPassphrase') throw err

          const entered = await askForText({
            title: t(`keyImport.reason.${reason}`),
            secret: true,
            placeholder: t('keyImport.passphrasePlaceholder')
          })
          if (!entered) return
          passphrase = entered
        }
      }
    })
  }

  /**
   * Removes one key from the ring.
   *
   * The warning is not boilerplate: mail encrypted to this key stays encrypted to it, so
   * deleting it is the one action here that destroys access to something.
   */
  function handleDeleteKey(fingerprint: string): void {
    if (!window.confirm(t('settings.pgpConfirmDeleteKey'))) return
    void run('delete', async () => {
      await window.peregrine.pgp.deleteAccountKey({ accountId: account.id, fingerprint })
      await reloadKeys()
    })
  }

  function handleActivate(fingerprint: string): void {
    void run('activate', async () => {
      await window.peregrine.pgp.setActiveKey({ accountId: account.id, fingerprint })
      await reloadKeys()
    })
  }

  function handleExport(): void {
    void run('export', async () => {
      const { savedPath } = await window.peregrine.pgp.exportPublicKey(account.id)
      if (savedPath) setNotice(savedPath)
    })
  }

  /** The state of the key that signs; the retired ones expiring is expected, not news. */
  const activeHealth = ((): { state: ReturnType<typeof keyHealth>; days: number | null } | null => {
    const active = keys.find((key) => key.isActive)
    if (!active) return null
    return {
      state: keyHealth({ expiresAt: active.expiresAt, revoked: active.revoked }),
      days: daysUntilExpiry(active.expiresAt)
    }
  })()

  function handlePublish(): void {
    void run('publish', async () => {
      await window.peregrine.pgp.publishKey(account.id)
      setNotice(t('settings.pgpPublished'))
    })
  }

  return (
    <section className="settings-section">
      <h3>{t('settings.pgp')}</h3>

      {keyInfo ? (
        <>
          <div className="pgp-key-info">
            <KeyRound size={15} strokeWidth={1.75} />
            <div>
              <div className="settings-account-name">{t('settings.pgpKeyActive')}</div>
              <span className="settings-account-email">{keyInfo.fingerprint}</span>
            </div>
          </div>

          {/* The signing key is the one whose state costs something: an expired key keeps
              signing and nobody accepts the signature, without anything saying so. */}
          {activeHealth && needsAttention(activeHealth.state) && (
            <p className={`pgp-health ${activeHealth.state}`}>
              <AlertTriangle size={13} strokeWidth={2} />
              {activeHealth.state === 'expiringSoon'
                ? t('settings.pgpExpiringSoon', { count: activeHealth.days ?? 0 })
                : t(`settings.pgpHealth.${activeHealth.state}`)}
            </p>
          )}
          <div className="pgp-actions">
            <button onClick={handleExport} disabled={busy !== null}>
              <Download size={15} strokeWidth={1.75} />
              {t('settings.pgpExportKey')}
            </button>
            <button onClick={handlePublish} disabled={busy !== null}>
              <UploadCloud size={15} strokeWidth={1.75} />
              {busy === 'publish' ? t('settings.pgpPublishing') : t('settings.pgpPublish')}
            </button>
            <button onClick={() => void handleImport()} disabled={busy !== null}>
              <Upload size={15} strokeWidth={1.75} />
              {t('settings.pgpImportKey')}
            </button>
          </div>

          {/* Shown only once there is something to choose between - a ring of one is just
              the key above it, and repeating it would only look like a mistake. */}
          {keys.length > 1 && (
            <>
              <h4 className="pgp-ring-heading">{t('settings.pgpRing')}</h4>
              <p className="settings-hint">{t('settings.pgpRingHint')}</p>
              <ul className="pgp-ring">
                {keys.map((key) => (
                  <li key={key.fingerprint} className="pgp-ring-row">
                    <div className="pgp-ring-main">
                      <code>{key.fingerprint}</code>
                      <span className="pgp-ring-date">
                        {new Date(key.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="pgp-ring-actions">
                      {key.isActive ? (
                        <span className="pgp-ring-active">{t('settings.pgpKeyActiveBadge')}</span>
                      ) : (
                        <button
                          disabled={busy !== null}
                          onClick={() => handleActivate(key.fingerprint)}
                        >
                          {t('settings.pgpMakeActive')}
                        </button>
                      )}
                      <button
                        disabled={busy !== null}
                        onClick={() => handleDeleteKey(key.fingerprint)}
                        title={t('settings.pgpDeleteKey')}
                      >
                        <Trash2 size={14} strokeWidth={1.75} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          {keys.length === 1 && (
            <div className="pgp-actions">
              <button onClick={() => handleDeleteKey(keyInfo.fingerprint)} disabled={busy !== null}>
                <Trash2 size={15} strokeWidth={1.75} />
                {t('settings.pgpDeleteKey')}
              </button>
            </div>
          )}

          {/* Only offered once a key exists - without one there is nothing to sign with. */}
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={settings.signByDefault}
              onChange={(e) => void updateSettings({ signByDefault: e.target.checked })}
            />
            {t('settings.pgpSignByDefault')}
          </label>
          <span className="settings-hint">{t('settings.pgpSignHint')}</span>
        </>
      ) : (
        <>
          <p className="settings-account-email">{t('settings.pgpNoKey')}</p>
          <div className="pgp-actions">
            <button onClick={handleGenerate} disabled={busy !== null}>
              <KeyRound size={15} strokeWidth={1.75} />
              {busy === 'generate' ? t('settings.pgpGenerating') : t('settings.pgpGenerateKey')}
            </button>
            <button onClick={() => void handleImport()} disabled={busy !== null}>
              <Upload size={15} strokeWidth={1.75} />
              {t('settings.pgpImportKey')}
            </button>
          </div>
        </>
      )}

      {notice && <p className="pgp-notice">{notice}</p>}
      {error && <p className="wizard-error">{error}</p>}
    </section>
  )
}

export default PgpSection
