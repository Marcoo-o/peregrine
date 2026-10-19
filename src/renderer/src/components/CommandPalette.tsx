import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import { rankItems } from '@peregrine/core/fuzzy'
import { useDialog } from '@renderer/util/useDialog'
import type { LucideIcon } from 'lucide-react'

export interface Command {
  id: string
  label: string
  /** Shown on the right. The keyboard shortcut, or which folder a command belongs to. */
  hint?: string
  icon?: LucideIcon
  run: () => void
}

interface CommandPaletteProps {
  commands: Command[]
  onClose: () => void
}

/**
 * Everything reachable by typing.
 *
 * The list is filtered by subsequence rather than substring, so a few characters of what you
 * mean are enough. Ordering is by match quality, not alphabetical: the thing you described
 * best should be the thing Enter runs.
 */
function CommandPalette({ commands, onClose }: CommandPaletteProps): JSX.Element {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const panelRef = useDialog(onClose)
  const listRef = useRef<HTMLUListElement>(null)

  const matches = useMemo(
    () => rankItems(query, commands, (command) => `${command.label} ${command.hint ?? ''}`),
    [query, commands]
  )

  // A new query changes the order, so a remembered position would point at something else.
  useEffect(() => setActive(0), [query])

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function handleKey(event: React.KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((i) => Math.min(i + 1, matches.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const chosen = matches[active]
      if (!chosen) return
      // Close first: a command that opens a window or navigates should not leave the palette
      // hanging over what it just did.
      onClose()
      chosen.item.run()
    }
    // Escape is handled by `useDialog` above, on the window rather than on this field.
  }

  return (
    <div className="modal-backdrop palette-backdrop" onClick={onClose}>
      <div
        className="palette"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('palette.placeholder')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="palette-input">
          <Search size={15} strokeWidth={1.75} />
          <input
            autoFocus
            value={query}
            placeholder={t('palette.placeholder')}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
          />
        </div>

        <ul className="palette-list" ref={listRef}>
          {matches.map((entry, index) => {
            const Icon = entry.item.icon
            return (
              <li key={entry.item.id}>
                <button
                  className={index === active ? 'palette-item active' : 'palette-item'}
                  // Selecting on hover keeps mouse and keyboard pointing at the same row.
                  onMouseMove={() => setActive(index)}
                  onClick={() => {
                    onClose()
                    entry.item.run()
                  }}
                >
                  {Icon && <Icon size={14} strokeWidth={1.75} />}
                  <span className="palette-label">{entry.item.label}</span>
                  {entry.item.hint && <kbd>{entry.item.hint}</kbd>}
                </button>
              </li>
            )
          })}
          {matches.length === 0 && <li className="palette-empty">{t('palette.noMatch')}</li>}
        </ul>
      </div>
    </div>
  )
}

export default CommandPalette
