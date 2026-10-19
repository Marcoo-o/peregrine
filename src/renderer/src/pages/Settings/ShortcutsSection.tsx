import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, RotateCcw, X } from 'lucide-react'
import {
  conflictsIn,
  isAssignable,
  parseShortcuts,
  SHORTCUT_ACTIONS,
  shortcutFromEvent,
  type ShortcutAction
} from '@peregrine/core/shortcuts'
import { useSettingsStore } from '@renderer/state/settingsStore'

/**
 * Assigning the mailbox shortcuts.
 *
 * A key is recorded by pressing it rather than typed as text: "Shift+R" written by hand and
 * "Shift+R" as the browser reports it are not reliably the same string, and the difference
 * would only show up as a shortcut that quietly never fires.
 */
function ShortcutsSection(): JSX.Element {
  const { t } = useTranslation()
  const stored = useSettingsStore((s) => s.settings.shortcuts)
  const update = useSettingsStore((s) => s.update)
  const shortcuts = parseShortcuts(stored)
  const [recording, setRecording] = useState<ShortcutAction | null>(null)
  const [rejected, setRejected] = useState<string | null>(null)

  const conflicts = new Set(conflictsIn(shortcuts))

  function assign(action: ShortcutAction, value: string): void {
    const current = parseShortcuts(useSettingsStore.getState().settings.shortcuts)
    void update({ shortcuts: JSON.stringify({ ...current, [action]: value }) })
  }

  function handleKeyDown(action: ShortcutAction, event: React.KeyboardEvent): void {
    event.preventDefault()
    event.stopPropagation()
    // Modifier keys alone arrive as their own events while the real key is still coming.
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return

    const value = shortcutFromEvent(event)
    if (!isAssignable(value)) {
      setRejected(value)
      return
    }
    setRejected(null)
    setRecording(null)
    assign(action, value)
  }

  return (
    <section className="settings-section">
      <h3>{t('settings.sections.shortcuts')}</h3>
      <span className="settings-hint">{t('settings.shortcutsHint')}</span>

      <ul className="shortcut-list">
        {SHORTCUT_ACTIONS.map((action) => {
          const value = shortcuts[action]
          const isRecording = recording === action
          return (
            <li key={action} className="shortcut-row">
              <span className="shortcut-label">{t(`settings.shortcutAction.${action}`)}</span>

              <button
                className={
                  isRecording
                    ? 'shortcut-key recording'
                    : conflicts.has(action)
                      ? 'shortcut-key conflicting'
                      : 'shortcut-key'
                }
                // Focus is taken explicitly rather than relied on from the click: the button
                // has to receive the next key press, and a click is not the only way to get
                // here. Keyboard activation has to work too, which is rather the point.
                ref={(node) => {
                  if (isRecording && node && document.activeElement !== node) node.focus()
                }}
                onClick={() => {
                  setRejected(null)
                  setRecording(isRecording ? null : action)
                }}
                onKeyDown={(e) => isRecording && handleKeyDown(action, e)}
              >
                {isRecording ? (
                  t('settings.shortcutPressKey')
                ) : value ? (
                  <kbd>{value}</kbd>
                ) : (
                  <span className="shortcut-unassigned">{t('settings.shortcutUnassigned')}</span>
                )}
              </button>

              {value && !isRecording && (
                <button
                  className="icon-button"
                  aria-label={t('settings.shortcutClear')}
                  title={t('settings.shortcutClear')}
                  onClick={() => assign(action, '')}
                >
                  <X size={13} strokeWidth={1.75} />
                </button>
              )}
            </li>
          )
        })}
      </ul>

      {rejected && (
        <p className="wizard-error">{t('settings.shortcutRejected', { key: rejected })}</p>
      )}

      {/* A duplicate is not refused - the user may be mid-swap. But only one of the two would
          ever fire, so leaving it unsaid would look like a broken shortcut. */}
      {conflicts.size > 0 && (
        <p className="theme-contrast-warning">
          <AlertTriangle size={13} strokeWidth={1.75} />
          {t('settings.shortcutConflict')}
        </p>
      )}

      <div className="settings-inline-row">
        <button onClick={() => void update({ shortcuts: '{}' })}>
          <RotateCcw size={14} strokeWidth={1.75} />
          {t('settings.shortcutsReset')}
        </button>
      </div>
    </section>
  )
}

export default ShortcutsSection
