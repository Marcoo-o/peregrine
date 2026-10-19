import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Check, KeyRound, Lock, X } from 'lucide-react'
import type { KeyAssignment, KeyNote } from '@peregrine/core/keyImport'
import { isImportable } from '@peregrine/core/keyImport'
import type { AccountSummary, KeyImportResult, KeyImportSource } from '@peregrine/core/types'
import { toastError, toastInfo } from '@renderer/state/toastStore'
import { useDialog } from '@renderer/util/useDialog'

interface KeyImportDialogProps {
  source: KeyImportSource
  accounts: AccountSummary[]
  onClose: () => void
  onImported: () => void
}

/**
 * Taking a set of PGP keys over in one pass.
 *
 * The mapping is shown before anything is written. A key file says which addresses a key
 * carries, not which account it belongs to, and the guess is good but not certain. So it is
 * offered as a proposal rather than performed quietly.
 *
 * Keys that cannot go anywhere useful are listed with the reason rather than hidden. Someone
 * looking for their key needs to find it here and read why it is greyed out; a list that
 * silently drops it just looks broken.
 */
function KeyImportDialog({
  source,
  accounts,
  onClose,
  onImported
}: KeyImportDialogProps): JSX.Element {
  const { t } = useTranslation()
  const [origin, setOrigin] = useState<string | null>(null)
  const [assignments, setAssignments] = useState<KeyAssignment[] | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [passphrase, setPassphrase] = useState('')
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<KeyImportResult[] | null>(null)

  // Not while keys are being written: half an import is not a state to walk out of. The hook
  // also brings the focus in on open. This dialog used to arrange that for itself, with a
  // `tabIndex={-1}` on the panel, because Escape depended on it.
  const panelRef = useDialog(onClose, !running)

  const accountNames = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.emailAddress])),
    [accounts]
  )

  useEffect(() => {
    void window.peregrine.pgp
      .scanKeySource({ source })
      .then((scan) => {
        setOrigin(scan.origin)
        setAssignments(scan.assignments)
        // Pre-selected only where importing achieves something.
        setChosen(
          new Set(
            scan.assignments.filter(isImportable).map((assignment) => assignment.key.fingerprint)
          )
        )
      })
      .catch((err) => {
        toastError(err, t('keyImport.scanFailed'))
        setAssignments([])
      })
  }, [source])

  /** A passphrase is only worth asking for when a sealed private key is actually selected. */
  const needsPassphrase = (assignments ?? []).some(
    (assignment) =>
      chosen.has(assignment.key.fingerprint) &&
      assignment.accountIds.length > 0 &&
      assignment.notes.includes('locked')
  )

  function toggle(fingerprint: string): void {
    setChosen((prev) => {
      const next = new Set(prev)
      if (next.has(fingerprint)) next.delete(fingerprint)
      else next.add(fingerprint)
      return next
    })
  }

  async function handleImport(): Promise<void> {
    setRunning(true)
    try {
      const outcome = await window.peregrine.pgp.importKeys({
        source,
        fingerprints: [...chosen],
        passphrase
      })
      setResults(outcome)
      const imported = outcome.filter((r) => r.status === 'imported').length
      if (imported > 0) {
        toastInfo(t('keyImport.done', { count: imported }))
        onImported()
      }
      // A wrong passphrase is the one failure worth another attempt, so it is named rather
      // than folded into a general "did not work".
      if (outcome.some((r) => r.reason === 'wrongPassphrase')) {
        toastError(new Error(t('keyImport.wrongPassphrase')), t('keyImport.wrongPassphrase'))
      }
    } catch (err) {
      toastError(err, t('keyImport.failed'))
    } finally {
      setRunning(false)
    }
  }

  function targetLabel(assignment: KeyAssignment): string {
    if (assignment.accountIds.length > 0) {
      return assignment.accountIds.map((id) => accountNames.get(id) ?? id).join(', ')
    }
    return assignment.contactAddress ?? t('keyImport.noTarget')
  }

  const resultFor = (fingerprint: string): KeyImportResult | undefined =>
    results?.find((r) => r.fingerprint === fingerprint)

  const selectable = (assignments ?? []).filter(isImportable).length

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel key-import-panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="key-import-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="key-import-title">
          <KeyRound size={17} strokeWidth={1.75} />
          {t('keyImport.title')}
        </h3>

        {assignments == null ? (
          <p className="settings-hint">{t('keyImport.scanning')}</p>
        ) : assignments.length === 0 ? (
          <p className="settings-hint">
            {source.kind === 'thunderbird' ? t('keyImport.noThunderbird') : t('keyImport.emptyFile')}
          </p>
        ) : (
          <>
            {origin && <code className="import-profile-path">{origin}</code>}

            {/* The whole point of the Thunderbird route, said before the list rather than
                discovered by ticking a box that does not work. */}
            {source.kind === 'thunderbird' && (
              <p className="settings-hint key-import-note">{t('keyImport.thunderbirdSealed')}</p>
            )}

            <ul className="key-import-list">
              {assignments.map((assignment) => {
                const { key } = assignment
                const usable = isImportable(assignment)
                const result = resultFor(key.fingerprint)
                return (
                  <li
                    key={key.fingerprint}
                    className={usable ? 'key-import-row' : 'key-import-row blocked'}
                  >
                    <label className="key-import-head">
                      <input
                        type="checkbox"
                        checked={chosen.has(key.fingerprint)}
                        disabled={!usable || running || result?.status === 'imported'}
                        onChange={() => toggle(key.fingerprint)}
                      />
                      <span className="key-import-uid">
                        {key.userIds[0] ?? t('keyImport.noUserId')}
                      </span>
                      {key.hasPrivate && (
                        <span className="key-import-badge">
                          <Lock size={12} strokeWidth={2} />
                          {t('keyImport.private')}
                        </span>
                      )}
                      {result?.status === 'imported' && (
                        <span className="import-status ok">
                          <Check size={13} strokeWidth={2} />
                        </span>
                      )}
                    </label>

                    <div className="key-import-meta">
                      <code>{key.fingerprint}</code>
                      <span>{t('keyImport.goesTo', { target: targetLabel(assignment) })}</span>
                    </div>

                    {assignment.notes.length > 0 && (
                      <p className="key-import-notes">
                        <AlertTriangle size={12} strokeWidth={2} />
                        {assignment.notes.map((note: KeyNote) => t(`keyImport.note.${note}`)).join(' · ')}
                      </p>
                    )}

                    {result?.status === 'failed' && (
                      <p className="wizard-error">
                        {t(`keyImport.reason.${result.reason ?? 'unreadable'}`)}
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>

            {needsPassphrase && (
              <label className="settings-field">
                {t('keyImport.passphrase')}
                <input
                  type="password"
                  value={passphrase}
                  disabled={running}
                  onChange={(e) => setPassphrase(e.target.value)}
                />
                <span className="settings-hint">{t('keyImport.passphraseHint')}</span>
              </label>
            )}

            {selectable === 0 && <p className="settings-hint">{t('keyImport.nothingToDo')}</p>}
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
            disabled={running || chosen.size === 0 || (needsPassphrase && passphrase === '')}
          >
            {running ? t('keyImport.importing') : t('keyImport.importCount', { count: chosen.size })}
          </button>
        </div>
      </div>
    </div>
  )
}

export default KeyImportDialog
