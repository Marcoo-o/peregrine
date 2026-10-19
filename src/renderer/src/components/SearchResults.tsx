import { useTranslation } from 'react-i18next'
import type { SearchResultItem } from '@peregrine/core/types'

interface SearchResultsProps {
  results: SearchResultItem[]
  loading: boolean
  /** Search spans every mailbox, so each hit names the account it came from. */
  accountNameFor: (accountId: string) => string
  onSelect: (item: SearchResultItem) => void
}

function SearchResults({
  results,
  loading,
  accountNameFor,
  onSelect
}: SearchResultsProps): JSX.Element {
  const { t } = useTranslation()

  if (loading) return <p className="message-list-empty">{t('mailbox.searching')}</p>
  if (results.length === 0) return <p className="message-list-empty">{t('mailbox.noSearchResults')}</p>

  return (
    <ul className="search-results">
      {results.map((item) => (
        <li key={item.id}>
          <button className="search-result-row" onClick={() => onSelect(item)}>
            <span className="search-result-subject">{item.subject || t('mailbox.noSubject')}</span>
            <span className="search-result-meta">
              {item.fromName || item.fromAddress} · {accountNameFor(item.accountId)} ·{' '}
              {item.folderDisplayName}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export default SearchResults
