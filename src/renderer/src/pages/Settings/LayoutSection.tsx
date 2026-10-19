import { useTranslation } from 'react-i18next'
import type { ReaderPosition } from '@peregrine/core/types'
import { useSettingsStore } from '@renderer/state/settingsStore'
import Segmented from '@renderer/components/Segmented'

const readerPositions: ReaderPosition[] = ['bottom', 'right', 'hidden']

const DEFAULT_PANES = { sidebarWidth: 240, readerPaneHeight: 420, readerPaneWidth: 620 }

function LayoutSection(): JSX.Element {
  const { t } = useTranslation()
  const { settings, update } = useSettingsStore()

  return (
    <section className="settings-section">
      <h3>{t('settings.sections.layout')}</h3>

      <div className="settings-field">
        {t('settings.readerPosition')}
        <Segmented
          value={settings.readerPosition}
          options={readerPositions.map((position) => ({
            value: position,
            label: t(`settings.readerPositionOption.${position}`)
          }))}
          onChange={(readerPosition) => void update({ readerPosition })}
        />
        <span className="settings-hint">{t('settings.readerPositionHint')}</span>
      </div>

      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={settings.unifiedFolders}
          onChange={(e) => void update({ unifiedFolders: e.target.checked })}
        />
        {t('settings.unifiedFolders')}
      </label>
      <span className="settings-hint">{t('settings.unifiedFoldersHint')}</span>

      <div className="settings-field">
        {t('settings.paneSizes')}
        <button onClick={() => void update(DEFAULT_PANES)}>{t('settings.resetPanes')}</button>
      </div>
    </section>
  )
}

export default LayoutSection
