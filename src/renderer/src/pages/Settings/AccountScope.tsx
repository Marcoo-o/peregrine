import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { AccountSummary } from '@peregrine/core/types'
import { useAccountsStore } from '@renderer/state/accountsStore'

interface AccountScopeProps {
  children: (account: AccountSummary) => ReactNode
}

/**
 * Per-account settings (PGP keys, filter rules) need to say *which* mailbox they apply to.
 * This wrapper owns that picker so each section stays a plain component taking one account.
 */
function AccountScope({ children }: AccountScopeProps): JSX.Element {
  const { t } = useTranslation()
  const { accounts, selectedAccountId } = useAccountsStore()
  const [accountId, setAccountId] = useState(selectedAccountId ?? accounts[0]?.id ?? '')

  const account = accounts.find((a) => a.id === accountId) ?? accounts[0]
  if (!account) return <p className="settings-hint">{t('settings.noAccounts')}</p>

  return (
    <>
      <label className="settings-field account-scope-picker">
        {t('settings.forAccount')}
        <select value={account.id} onChange={(event) => setAccountId(event.target.value)}>
          {accounts.map((option) => (
            <option key={option.id} value={option.id}>
              {option.displayName || option.emailAddress}
            </option>
          ))}
        </select>
      </label>
      {children(account)}
    </>
  )
}

export default AccountScope
