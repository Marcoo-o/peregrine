import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp } from 'lucide-react'
import {
  DEFAULT_COLUMNS,
  MESSAGE_COLUMNS,
  parseColumns,
  type MessageColumnId
} from '@peregrine/core/messageColumns'
import { useSettingsStore } from '@renderer/state/settingsStore'

const ALL_COLUMNS = Object.keys(MESSAGE_COLUMNS) as MessageColumnId[]

/**
 * Which columns the message list shows, and in which order.
 *
 * Arrows rather than drag-and-drop: the list is at most six entries long, and arrows work
 * with the keyboard, which dragging does not.
 */
function ColumnSettings(): JSX.Element {
  const { t } = useTranslation()
  const stored = useSettingsStore((s) => s.settings.messageColumns)
  const update = useSettingsStore((s) => s.update)
  const columns = parseColumns(stored)

  function save(next: MessageColumnId[]): void {
    void update({ messageColumns: JSON.stringify(next) })
  }

  /**
   * Reads the current value from the store rather than from this render.
   *
   * Two clicks before the re-render would otherwise both start from the same stale list, and
   * the second would silently undo the first.
   */
  function change(apply: (current: MessageColumnId[]) => MessageColumnId[]): void {
    save(apply(parseColumns(useSettingsStore.getState().settings.messageColumns)))
  }

  function toggle(id: MessageColumnId): void {
    change((current) =>
      current.includes(id) ? current.filter((c) => c !== id) : [...current, id]
    )
  }

  function move(id: MessageColumnId, delta: number): void {
    change((current) => {
      const index = current.indexOf(id)
      const target = index + delta
      if (index < 0 || target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  return (
    <div className="settings-field">
      {t('settings.columns')}
      <ul className="column-settings-list">
        {/* Visible ones first, in their order; then whatever is left to add. */}
        {[...columns, ...ALL_COLUMNS.filter((id) => !columns.includes(id))].map((id) => {
          const visible = columns.includes(id)
          const index = columns.indexOf(id)
          return (
            <li key={id} className={visible ? 'column-setting' : 'column-setting hidden'}>
              <label>
                <input
                  type="checkbox"
                  checked={visible}
                  // The subject cannot be switched off: a list without it cannot be read, and
                  // there would be no way back to this setting from inside it.
                  disabled={id === 'subject'}
                  onChange={() => toggle(id)}
                />
                {t(`mailbox.columns.${id}`)}
              </label>
              {visible && (
                <span className="column-setting-order">
                  <button
                    className="icon-button"
                    disabled={index <= 0}
                    aria-label={t('settings.moveUp')}
                    onClick={() => move(id, -1)}
                  >
                    <ArrowUp size={13} strokeWidth={1.75} />
                  </button>
                  <button
                    className="icon-button"
                    disabled={index >= columns.length - 1}
                    aria-label={t('settings.moveDown')}
                    onClick={() => move(id, 1)}
                  >
                    <ArrowDown size={13} strokeWidth={1.75} />
                  </button>
                </span>
              )}
            </li>
          )
        })}
      </ul>
      <div className="settings-inline-row">
        <button onClick={() => save([...DEFAULT_COLUMNS])}>{t('settings.columnsReset')}</button>
      </div>
      <span className="settings-hint">{t('settings.columnWidthHint')}</span>
    </div>
  )
}

export default ColumnSettings
