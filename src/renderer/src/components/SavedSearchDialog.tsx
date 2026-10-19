import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Search } from 'lucide-react'
import type { AccountSummary } from '@peregrine/core/types'
import { SAVED_SEARCH_COLORS, toggleAccountScope, type SavedSearch } from '@peregrine/core/savedSearches'
import { useDialog } from '@renderer/util/useDialog'

interface SavedSearchDialogProps {
  /** The entry being edited, or a fresh draft when a new search is created. */
  draft: SavedSearch
  accounts: AccountSummary[]
  onSave: (entry: SavedSearch) => void
  onCancel: () => void
}

/**
 * Everything a saved search is, in one dialog.
 *
 * Name, query, colour and reach were four separate context menu entries, each with its own
 * one-line prompt. That works for a rename but not for the rest: which accounts a search
 * covers is a decision one makes while looking at the list of accounts, not while answering
 * a question about a single value.
 */
function SavedSearchDialog({
  draft,
  accounts,
  onSave,
  onCancel
}: SavedSearchDialogProps): JSX.Element {
  const { t } = useTranslation()
  const panelRef = useDialog(onCancel)
  const [name, setName] = useState(draft.name)
  const [query, setQuery] = useState(draft.query)
  const [color, setColor] = useState(draft.color)
  const [accountIds, setAccountIds] = useState<string[]>(draft.accountIds)
  const [includeTrash, setIncludeTrash] = useState(draft.includeTrash)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
    nameRef.current?.select()
  }, [])

  const canSave = name.trim() !== '' && query.trim() !== ''

  const submit = (): void => {
    if (!canSave) return
    onSave({
      ...draft,
      name: name.trim(),
      query: query.trim(),
      color,
      accountIds,
      includeTrash
    })
  }

  /** Enter saves, but only from the single-line fields; Escape closes via `useDialog`. */
  const handleKey = (event: React.KeyboardEvent): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      submit()
    }
  }

  const allAccounts = accountIds.length === 0

  const toggleAccount = (id: string): void => {
    setAccountIds((current) =>
      toggleAccountScope(
        current,
        accounts.map((account) => account.id),
        id
      )
    )
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal-panel saved-search-dialog"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="saved-search-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="saved-search-title">
          <Search size={15} /> {t('savedSearch.editTitle')}
        </h3>

        <label className="saved-search-label" htmlFor="saved-search-name">
          {t('savedSearch.nameLabel')}
        </label>
        <input
          id="saved-search-name"
          ref={nameRef}
          className="prompt-field"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={handleKey}
        />

        <label className="saved-search-label" htmlFor="saved-search-query">
          {t('savedSearch.queryLabel')}
        </label>
        <input
          id="saved-search-query"
          className="prompt-field saved-search-query"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKey}
        />
        <p className="saved-search-hint">{t('savedSearch.queryHint')}</p>

        <span className="saved-search-label">{t('savedSearch.colorLabel')}</span>
        <div className="saved-search-colors">
          {SAVED_SEARCH_COLORS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              className={`saved-search-color${swatch === color ? ' selected' : ''}`}
              style={{ background: swatch }}
              aria-label={swatch}
              aria-pressed={swatch === color}
              onClick={() => setColor(swatch)}
            >
              {swatch === color && <Check size={13} />}
            </button>
          ))}
        </div>

        {accounts.length > 1 && (
          <>
            <span className="saved-search-label">{t('savedSearch.accountsLabel')}</span>
            <div className="saved-search-accounts">
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={allAccounts}
                  onChange={() => setAccountIds(allAccounts ? [accounts[0]?.id ?? ''] : [])}
                />
                <span>{t('savedSearch.allAccounts')}</span>
              </label>
              {accounts.map((account) => (
                <label key={account.id} className="checkbox-field saved-search-account">
                  <input
                    type="checkbox"
                    checked={allAccounts || accountIds.includes(account.id)}
                    onChange={() => toggleAccount(account.id)}
                  />
                  <span className="saved-search-account-dot" style={{ background: account.color }} />
                  <span>{account.emailAddress}</span>
                </label>
              ))}
            </div>
          </>
        )}

        <label className="checkbox-field saved-search-trash">
          <input
            type="checkbox"
            checked={includeTrash}
            onChange={(event) => setIncludeTrash(event.target.checked)}
          />
          <span>{t('savedSearch.includeTrash')}</span>
        </label>

        <div className="modal-actions">
          <button onClick={onCancel}>{t('compose.cancel')}</button>
          <button className="primary" disabled={!canSave} onClick={submit}>
            {t('savedSearch.saveButton')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default SavedSearchDialog
