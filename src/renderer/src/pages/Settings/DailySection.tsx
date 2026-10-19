import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@renderer/state/settingsStore'
import { useTagsStore } from '@renderer/state/tagsStore'

/** Offered start hours; past noon it would stop being "when the day begins". */
const START_HOURS = [0, 3, 4, 5, 6, 7, 8]

function DailySection(): JSX.Element {
  const { t } = useTranslation()
  const { settings, update } = useSettingsStore()
  const tags = useTagsStore((s) => s.tags)

  useEffect(() => {
    void useTagsStore.getState().load()
  }, [])

  return (
    <section className="settings-section">
      <h3>{t('daily.title')}</h3>

      <label className="settings-field">
        {t('dailySettings.tag')}
        <select
          value={settings.dailyTagKeyword}
          onChange={(e) => void update({ dailyTagKeyword: e.target.value })}
        >
          <option value="">{t('dailySettings.tagOff')}</option>
          {tags.map((tag) => (
            <option key={tag.id} value={tag.keyword}>
              {tag.name}
            </option>
          ))}
        </select>
        <span className="settings-hint">{t('dailySettings.tagHint')}</span>
      </label>

      {tags.length === 0 && <p className="settings-hint">{t('dailySettings.noTags')}</p>}

      <label className="settings-field">
        {t('dailySettings.dayStart')}
        <select
          value={String(settings.dayStartHour)}
          onChange={(e) => void update({ dayStartHour: Number(e.target.value) })}
        >
          {START_HOURS.map((hour) => (
            <option key={hour} value={hour}>
              {hour === 0
                ? t('dailySettings.midnight')
                : t('dailySettings.hour', { hour: String(hour).padStart(2, '0') })}
            </option>
          ))}
        </select>
        <span className="settings-hint">{t('dailySettings.dayStartHint')}</span>
      </label>
    </section>
  )
}

export default DailySection
