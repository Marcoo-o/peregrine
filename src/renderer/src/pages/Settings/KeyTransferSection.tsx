import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileKey, Import } from 'lucide-react'
import type { KeyImportSource } from '@peregrine/core/types'
import { useAccountsStore } from '@renderer/state/accountsStore'
import KeyImportDialog from './KeyImportDialog'

/**
 * The way in for taking existing keys over, above the per-account settings.
 *
 * Deliberately not inside the account picker below it: a key file holds keys for several
 * addresses at once, and asking which account it belongs to before opening it gets the
 * question backwards. The file answers that itself.
 */
interface KeyTransferSectionProps {
  /** Fires once keys have landed, so the per-account view below stops showing the old state. */
  onImported: () => void
}

function KeyTransferSection({ onImported }: KeyTransferSectionProps): JSX.Element {
  const { t } = useTranslation()
  const accounts = useAccountsStore((s) => s.accounts)
  const [source, setSource] = useState<KeyImportSource | null>(null)

  async function chooseFile(): Promise<void> {
    const chosen = await window.peregrine.pgp.chooseKeyFile()
    if (chosen) setSource({ kind: 'file', path: chosen.path })
  }

  return (
    <section className="settings-section">
      <h3>{t('keyImport.sectionTitle')}</h3>
      <p className="settings-hint">{t('keyImport.sectionHint')}</p>

      <div className="pgp-actions">
        <button onClick={() => setSource({ kind: 'thunderbird' })}>
          <Import size={15} strokeWidth={1.75} />
          {t('keyImport.fromThunderbird')}
        </button>
        <button onClick={() => void chooseFile()}>
          <FileKey size={15} strokeWidth={1.75} />
          {t('keyImport.fromFile')}
        </button>
      </div>

      {/* How to get the sealed keys out of Thunderbird, since the app cannot do it itself. */}
      <details className="key-import-help">
        <summary>{t('keyImport.helpSummary')}</summary>
        <ol>
          <li>{t('keyImport.helpStep1')}</li>
          <li>{t('keyImport.helpStep2')}</li>
          <li>{t('keyImport.helpStep3')}</li>
          <li>{t('keyImport.helpStep4')}</li>
        </ol>
      </details>

      {source && (
        <KeyImportDialog
          source={source}
          accounts={accounts}
          onClose={() => setSource(null)}
          onImported={onImported}
        />
      )}
    </section>
  )
}

export default KeyTransferSection
