import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ClipboardPaste, RotateCcw } from 'lucide-react'
import {
  parseCustomTheme,
  serializeCustomTheme,
  THEME_TOKEN_IDS,
  themeWarnings,
  type ThemeTokenId
} from '@peregrine/core/customTheme'
import { useSettingsStore } from '@renderer/state/settingsStore'
import { toastInfo } from '@renderer/state/toastStore'

/**
 * Free choice of the surface and text colours.
 *
 * Reads the live computed value as the starting point for each picker, so a colour that has
 * not been overridden shows what is actually on screen rather than an empty swatch. The
 * built-in schemes differ between light and dark, and guessing a default here would show the
 * wrong one half the time.
 */
function currentValue(property: string, override: string | undefined): string {
  if (override) return override
  const computed = getComputedStyle(document.documentElement).getPropertyValue(property).trim()
  return /^#[0-9a-f]{6}$/i.test(computed) ? computed : '#808080'
}

function ThemeEditor(): JSX.Element {
  const { t } = useTranslation()
  const stored = useSettingsStore((s) => s.settings.customTheme)
  const update = useSettingsStore((s) => s.update)
  const theme = parseCustomTheme(stored)
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState<string | null>(null)

  const warnings = themeWarnings(theme)

  function setToken(id: ThemeTokenId, value: string): void {
    const next = parseCustomTheme(useSettingsStore.getState().settings.customTheme)
    next[id] = value
    void update({ customTheme: serializeCustomTheme(next) })
  }

  function clearToken(id: ThemeTokenId): void {
    const next = parseCustomTheme(useSettingsStore.getState().settings.customTheme)
    delete next[id]
    void update({ customTheme: serializeCustomTheme(next) })
  }

  function handleImport(): void {
    const parsed = parseCustomTheme(importText)
    if (Object.keys(parsed).length === 0) {
      setImportError(t('settings.themeImportInvalid'))
      return
    }
    setImportError(null)
    setImportText('')
    void update({ customTheme: serializeCustomTheme(parsed) })
    toastInfo(t('settings.themeImported', { count: Object.keys(parsed).length }))
  }

  return (
    <div className="settings-field">
      {t('settings.customTheme')}
      <span className="settings-hint">{t('settings.customThemeHint')}</span>

      <ul className="theme-token-list">
        {THEME_TOKEN_IDS.map((id) => {
          const property = `--${id.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
          const overridden = theme[id] != null
          return (
            <li key={id} className="theme-token">
              <label>
                <input
                  type="color"
                  value={currentValue(property, theme[id])}
                  onChange={(e) => setToken(id, e.target.value)}
                />
                <span>{t(`settings.themeToken.${id}`)}</span>
              </label>
              {overridden && (
                <button
                  className="icon-button"
                  aria-label={t('settings.themeTokenReset')}
                  title={t('settings.themeTokenReset')}
                  onClick={() => clearToken(id)}
                >
                  <RotateCcw size={13} strokeWidth={1.75} />
                </button>
              )}
            </li>
          )
        })}
      </ul>

      {/* Reported, not corrected: it is the user's scheme, but text nobody can read is worth
          saying out loud, because where it becomes obvious is usually somewhere else. */}
      {warnings.length > 0 && (
        <p className="theme-contrast-warning">
          <AlertTriangle size={13} strokeWidth={1.75} />
          {warnings
            .map((w) =>
              t('settings.themeContrast', {
                token: t(`settings.themeToken.${w.token}`),
                against: t(`settings.themeToken.${w.against}`),
                ratio: w.ratio.toFixed(1)
              })
            )
            .join(' · ')}
        </p>
      )}

      <div className="settings-inline-row">
        <button onClick={() => void update({ customTheme: '{}' })}>
          {t('settings.themeReset')}
        </button>
        <button
          onClick={() => {
            void navigator.clipboard.writeText(serializeCustomTheme(theme))
            toastInfo(t('settings.themeCopied'))
          }}
          disabled={Object.keys(theme).length === 0}
        >
          {t('settings.themeExport')}
        </button>
      </div>

      <details className="theme-import">
        <summary>{t('settings.themeImport')}</summary>
        <textarea
          rows={4}
          value={importText}
          placeholder='{"bg": "#101418", "text": "#e6e9ee"}'
          onChange={(e) => setImportText(e.target.value)}
        />
        {importError && <p className="wizard-error">{importError}</p>}
        <button onClick={handleImport} disabled={importText.trim() === ''}>
          <ClipboardPaste size={14} strokeWidth={1.75} />
          {t('settings.themeApply')}
        </button>
      </details>
    </div>
  )
}

export default ThemeEditor
