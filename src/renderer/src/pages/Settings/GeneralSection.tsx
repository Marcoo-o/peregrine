import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@renderer/state/settingsStore'
import Segmented from '@renderer/components/Segmented'
import { supportedLanguages } from '../../i18n'

/** Each language named in itself, so it can be found by somebody who reads no other. */
const languageLabels: Record<string, string> = {
  en: 'English',
  de: 'Deutsch',
  es: 'Español',
  fr: 'Français',
  pt: 'Português'
}

/** -1 means "never mark as read automatically". */
const MARK_READ_OPTIONS = [0, 2000, -1]

/** Minutes between background refreshes of all folders; 0 switches the scheduler off. */
const SYNC_INTERVAL_OPTIONS = [0, 5, 10, 30, 60]

/** Seconds a sent message waits before it leaves; 0 sends straight away. */
const UNDO_SEND_OPTIONS = [0, 5, 10, 30]

function GeneralSection(): JSX.Element {
  const { t } = useTranslation()
  const { settings, update } = useSettingsStore()

  return (
    <section className="settings-section">
      <h3>{t('settings.sections.general')}</h3>

      <label className="settings-field">
        {t('settings.language')}
        <select value={settings.language} onChange={(e) => void update({ language: e.target.value })}>
          <option value="system">{t('settings.languageSystem')}</option>
          {supportedLanguages.map((lang) => (
            <option key={lang} value={lang}>
              {languageLabels[lang] ?? lang}
            </option>
          ))}
        </select>
      </label>

      <div className="settings-field">
        {t('settings.markReadDelay')}
        <Segmented
          value={String(settings.markReadDelayMs)}
          options={MARK_READ_OPTIONS.map((value) => ({
            value: String(value),
            label: t(`settings.markReadOption.${value === -1 ? 'never' : value === 0 ? 'immediate' : 'delayed'}`)
          }))}
          onChange={(value) => void update({ markReadDelayMs: Number(value) })}
        />
        <span className="settings-hint">{t('settings.markReadHint')}</span>
      </div>

      <label className="settings-field">
        {t('settings.syncInterval')}
        <select
          value={String(settings.syncIntervalMinutes)}
          onChange={(e) => void update({ syncIntervalMinutes: Number(e.target.value) })}
        >
          {SYNC_INTERVAL_OPTIONS.map((minutes) => (
            <option key={minutes} value={minutes}>
              {minutes === 0
                ? t('settings.syncIntervalOff')
                : t('settings.syncIntervalMinutes', { count: minutes })}
            </option>
          ))}
        </select>
        <span className="settings-hint">{t('settings.syncIntervalHint')}</span>
      </label>

      <label className="settings-field">
        {t('settings.undoSend')}
        <select
          value={String(settings.undoSendSeconds)}
          onChange={(e) => void update({ undoSendSeconds: Number(e.target.value) })}
        >
          {UNDO_SEND_OPTIONS.map((seconds) => (
            <option key={seconds} value={seconds}>
              {seconds === 0
                ? t('settings.undoSendOff')
                : t('settings.undoSendSeconds', { count: seconds })}
            </option>
          ))}
        </select>
        <span className="settings-hint">{t('settings.undoSendHint')}</span>
      </label>

    </section>
  )
}

export default GeneralSection
