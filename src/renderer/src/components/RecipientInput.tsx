import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import type { Contact } from '@peregrine/core/types'

interface RecipientInputProps {
  label: string
  /** Comma separated list, so the value stays a plain string for the compose payload. */
  value: string
  contacts: Contact[]
  autoFocus?: boolean
  onChange: (value: string) => void
}

const SEPARATORS = [',', ';']

export function splitRecipients(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean)
}

/** Good enough to flag typos without rejecting valid-but-unusual addresses. */
export function looksLikeAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(value)
}

function RecipientInput({
  label,
  value,
  contacts,
  autoFocus,
  onChange
}: RecipientInputProps): JSX.Element {
  const [draft, setDraft] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const recipients = useMemo(() => splitRecipients(value), [value])

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  // Contacts arrive already ordered by how often they were written to.
  const suggestions = useMemo(() => {
    const needle = draft.trim().toLowerCase()
    if (needle.length < 2) return []
    const chosen = new Set(recipients.map((r) => r.toLowerCase()))
    return contacts
      .filter(
        (contact) =>
          !chosen.has(contact.email.toLowerCase()) &&
          (contact.email.toLowerCase().includes(needle) ||
            contact.name.toLowerCase().includes(needle))
      )
      .slice(0, 6)
  }, [draft, contacts, recipients])

  function commit(address: string): void {
    const trimmed = address.trim()
    if (!trimmed) return
    if (!recipients.some((r) => r.toLowerCase() === trimmed.toLowerCase())) {
      onChange([...recipients, trimmed].join(', '))
    }
    setDraft('')
    setHighlight(0)
  }

  function removeAt(index: number): void {
    onChange(recipients.filter((_, i) => i !== index).join(', '))
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown' && suggestions.length > 0) {
      event.preventDefault()
      setHighlight((h) => (h + 1) % suggestions.length)
      return
    }
    if (event.key === 'ArrowUp' && suggestions.length > 0) {
      event.preventDefault()
      setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length)
      return
    }
    if (event.key === 'Enter' || event.key === 'Tab' || SEPARATORS.includes(event.key)) {
      if (draft.trim() === '') return
      event.preventDefault()
      commit(suggestions[highlight]?.email ?? draft)
      return
    }
    // Backspace on an empty input walks back into the chips, as chip inputs conventionally do.
    if (event.key === 'Backspace' && draft === '' && recipients.length > 0) {
      event.preventDefault()
      removeAt(recipients.length - 1)
    }
  }

  return (
    <div className="recipient-field">
      <span className="recipient-label">{label}</span>
      <div className="recipient-chips" onClick={() => inputRef.current?.focus()}>
        {recipients.map((recipient, index) => (
          <span
            key={`${recipient}-${index}`}
            className={looksLikeAddress(recipient) ? 'recipient-chip' : 'recipient-chip invalid'}
            title={recipient}
          >
            {recipient}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                removeAt(index)
              }}
              aria-label={recipient}
            >
              <X size={11} strokeWidth={2} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="recipient-input"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            setHighlight(0)
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          // Committing on blur prevents a half-typed address from silently disappearing.
          onBlur={() => {
            setFocused(false)
            commit(draft)
          }}
        />
      </div>
      {focused && suggestions.length > 0 && (
        <ul className="recipient-suggestions">
          {suggestions.map((contact, index) => (
            <li key={contact.id}>
              <button
                type="button"
                className={index === highlight ? 'active' : undefined}
                // mousedown fires before blur, so the click is not lost to the blur handler.
                onMouseDown={(event) => {
                  event.preventDefault()
                  commit(contact.email)
                }}
              >
                <span className="suggestion-name">{contact.name || contact.email}</span>
                {contact.name && <span className="suggestion-email">{contact.email}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default RecipientInput
