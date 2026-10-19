import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Download, Pencil, Plus, Trash2 } from 'lucide-react'
import { useAccountsStore } from '@renderer/state/accountsStore'
import { useConnectionStore } from '@renderer/state/connectionStore'
import ConnectionIndicator from '@renderer/components/ConnectionIndicator'
import AccountEditor from './AccountEditor'
import ThunderbirdImport from './ThunderbirdImport'

interface AccountsSectionProps {
  onAddAccount: () => void
}

function AccountsSection({ onAddAccount }: AccountsSectionProps): JSX.Element {
  const { t } = useTranslation()
  const { accounts, load } = useAccountsStore()
  const connectionStates = useConnectionStore((s) => s.states)
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  const editingAccount = accounts.find((a) => a.id === editingAccountId)

  async function handleRemove(accountId: string): Promise<void> {
    if (!window.confirm(t('settings.confirmRemoveAccount'))) return
    await window.peregrine.accounts.remove(accountId)
    void load()
  }

  if (editingAccount) {
    return (
      <section className="settings-section">
        <button className="settings-inline-back" onClick={() => setEditingAccountId(null)}>
          <ArrowLeft size={14} strokeWidth={1.75} />
          {t('settings.accounts')}
        </button>
        <AccountEditor
          account={editingAccount}
          onDone={() => {
            setEditingAccountId(null)
            void load()
          }}
        />
      </section>
    )
  }

  return (
    <section className="settings-section">
      <div className="settings-section-header">
        <h3>{t('settings.accounts')}</h3>
        <div className="settings-header-actions">
          <button onClick={() => setImporting(true)}>
            <Download size={15} strokeWidth={1.75} />
            {t('settings.importFromThunderbird')}
          </button>
          <button onClick={onAddAccount}>
            <Plus size={15} strokeWidth={1.75} />
            {t('settings.addAccount')}
          </button>
        </div>
      </div>
      <ul className="settings-account-list">
        {accounts.map((account) => (
          <li key={account.id} className="settings-account-row">
            <span className="account-color-dot" style={{ background: account.color }} />
            <ConnectionIndicator state={connectionStates[account.id]} />
            <div className="settings-account-info">
              <span className="settings-account-name">
                {account.displayName || account.emailAddress}
              </span>
              <span className="settings-account-email">{account.emailAddress}</span>
            </div>
            <button
              onClick={() => setEditingAccountId(account.id)}
              aria-label={t('settings.editAccount')}
              title={t('settings.editAccount')}
            >
              <Pencil size={15} strokeWidth={1.75} />
            </button>
            <button
              onClick={() => void handleRemove(account.id)}
              aria-label={t('settings.removeAccount')}
              title={t('settings.removeAccount')}
            >
              <Trash2 size={15} strokeWidth={1.75} />
            </button>
          </li>
        ))}
      </ul>

      {importing && (
        <ThunderbirdImport
          existingAddresses={accounts.map((a) => a.emailAddress)}
          onClose={() => setImporting(false)}
          onImported={() => void load()}
        />
      )}
    </section>
  )
}

export default AccountsSection
