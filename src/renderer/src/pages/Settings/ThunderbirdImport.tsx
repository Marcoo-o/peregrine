import { errorText } from '@renderer/util/errorText'
import { useDialog } from '@renderer/util/useDialog'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Download, X } from 'lucide-react'
import type { ImportableAccount } from '@peregrine/core/thunderbirdPrefs'
import { toastError, toastInfo } from '@renderer/state/toastStore'

interface ThunderbirdImportProps {
  /** Addresses already set up here, so accounts are not offered twice. */
  existingAddresses: string[]
  onClose: () => void
  onImported: () => void
}

interface Row {
  account: ImportableAccount
  selected: boolean
  password: string
  status: 'pending' | 'importing' | 'done' | 'failed'
  error?: string
}

/**
 * Takes accounts over from Thunderbird.
 *
 * Passwords are the one thing that cannot come along: Thunderbird keeps them encrypted
 * against its own profile key, and decrypting a foreign password store is neither something
 * this app should be able to do nor something that would survive Thunderbird's next update.
 * Everything else is filled in, so what remains is one password per account.
 */
function ThunderbirdImport({
  existingAddresses,
  onClose,
  onImported
}: ThunderbirdImportProps): JSX.Element {
  const { t } = useTranslation()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [profilePath, setProfilePath] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  // Not while accounts are being created: they are added one after another, and walking out
  // halfway would leave the list showing a run that is still going.
  const panelRef = useDialog(onClose, !running)

  useEffect(() => {
    void window.peregrine.accounts
      .scanThunderbird()
      .then(({ profilePath: path, accounts }) => {
        setProfilePath(path)
        const known = new Set(existingAddresses.map((a) => a.toLowerCase()))
        setRows(
          accounts.map((account) => ({
            account,
            // Pre-selected only where it can actually work: no blockers, not already here.
            selected:
              account.blockers.length === 0 && !known.has(account.emailAddress.toLowerCase()),
            password: '',
            status: 'pending'
          }))
        )
      })
      .catch((err) => {
        toastError(err, t('import.scanFailed'))
        setRows([])
      })
  }, [])

  function update(index: number, patch: Partial<Row>): void {
    setRows((prev) => prev?.map((row, i) => (i === index ? { ...row, ...patch } : row)) ?? prev)
  }

  const importable = (rows ?? []).filter(
    (row) => row.selected && row.account.blockers.length === 0 && row.password !== ''
  )

  async function handleImport(): Promise<void> {
    if (!rows) return
    setRunning(true)
    let imported = 0

    // One after another rather than all at once: each account opens IMAP and SMTP connections
    // on creation, and fifteen at a time is how a mail server decides it is being attacked.
    for (const [index, row] of rows.entries()) {
      if (!row.selected || row.account.blockers.length > 0 || row.password === '') continue
      update(index, { status: 'importing', error: undefined })
      try {
        await window.peregrine.accounts.create({
          displayName: row.account.displayName,
          emailAddress: row.account.emailAddress,
          imapHost: row.account.imapHost,
          imapPort: row.account.imapPort,
          imapSecure: row.account.imapSecure,
          imapUsername: row.account.imapUsername,
          imapPassword: row.password,
          smtpHost: row.account.smtpHost,
          smtpPort: row.account.smtpPort,
          smtpSecure: row.account.smtpSecure,
          smtpUsername: row.account.smtpUsername,
          smtpPassword: row.password
        })
        update(index, { status: 'done', password: '' })
        imported += 1
      } catch (err) {
        // Keep going: one wrong password must not cost the other fourteen.
        update(index, {
          status: 'failed',
          error: errorText(err)
        })
      }
    }

    setRunning(false)
    if (imported > 0) {
      toastInfo(t('import.done', { count: imported }))
      onImported()
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel import-panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('thunderbird.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>
          <Download size={17} strokeWidth={1.75} />
          {t('import.title')}
        </h3>

        {rows == null ? (
          <p className="settings-hint">{t('import.scanning')}</p>
        ) : profilePath == null ? (
          <p className="settings-hint">{t('import.notFound')}</p>
        ) : rows.length === 0 ? (
          <p className="settings-hint">{t('import.noAccounts')}</p>
        ) : (
          <>
            <p className="settings-hint">{t('import.passwordNote')}</p>
            <code className="import-profile-path">{profilePath}</code>

            <ul className="import-list">
              {rows.map((row, index) => {
                const blocked = row.account.blockers.length > 0
                const alreadyHere = existingAddresses.some(
                  (a) => a.toLowerCase() === row.account.emailAddress.toLowerCase()
                )
                return (
                  <li key={row.account.key} className={blocked ? 'import-row blocked' : 'import-row'}>
                    <label className="import-row-head">
                      <input
                        type="checkbox"
                        checked={row.selected}
                        disabled={blocked || running || row.status === 'done'}
                        onChange={(e) => update(index, { selected: e.target.checked })}
                      />
                      <span className="import-address">{row.account.emailAddress}</span>
                      <span className="import-server">
                        {row.account.imapHost}:{row.account.imapPort} · {row.account.imapSecure}
                      </span>
                      {row.status === 'done' && (
                        <span className="import-status ok">
                          <Check size={13} strokeWidth={2} />
                        </span>
                      )}
                    </label>

                    {blocked && (
                      <p className="import-blocker">
                        {row.account.blockers
                          .map((blocker) => t(`import.blocker.${blocker}`))
                          .join(' · ')}
                      </p>
                    )}

                    {!blocked && row.selected && row.status !== 'done' && (
                      <input
                        type="password"
                        className="import-password"
                        placeholder={t('import.passwordFor', {
                          address: row.account.emailAddress
                        })}
                        value={row.password}
                        disabled={running}
                        onChange={(e) => update(index, { password: e.target.value })}
                      />
                    )}

                    {row.status === 'failed' && <p className="wizard-error">{row.error}</p>}
                  </li>
                )
              })}
            </ul>
          </>
        )}

        <div className="modal-actions">
          <button onClick={onClose} disabled={running}>
            <X size={14} strokeWidth={1.75} />
            {t('import.close')}
          </button>
          <button
            className="primary-button"
            onClick={() => void handleImport()}
            disabled={running || importable.length === 0}
          >
            {running
              ? t('import.importing')
              : t('import.importCount', { count: importable.length })}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ThunderbirdImport
