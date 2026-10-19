import { useTranslation } from 'react-i18next'
import type { AccentColor, DateFormat, Density, ThemeMode } from '@peregrine/core/types'
import { useSettingsStore } from '@renderer/state/settingsStore'
import Segmented from '@renderer/components/Segmented'
import ColumnSettings from './ColumnSettings'
import ThemeEditor from './ThemeEditor'

const themes: ThemeMode[] = ['system', 'light', 'dark']
/** 'custom' is not in here: it gets the colour picker rather than a fixed swatch. */
const accents: AccentColor[] = [
  'blue',
  'indigo',
  'violet',
  'magenta',
  'rose',
  'red',
  'amber',
  'lime',
  'green',
  'teal',
  'cyan',
  'slate'
]
const densities: Density[] = ['comfortable', 'cozy', 'compact']
const dateFormats: DateFormat[] = ['relative', 'short', 'long', 'iso']

/** Percentages rather than pixels: what this scales is the whole interface, not one font. */
const FONT_SCALES = [0.85, 0.9, 1, 1.1, 1.25, 1.4]

function AppearanceSection(): JSX.Element {
  const { t } = useTranslation()
  const { settings, update } = useSettingsStore()

  return (
    <section className="settings-section">
      <h3>{t('settings.appearance')}</h3>

      <div className="settings-field">
        {t('settings.theme')}
        <Segmented
          value={settings.theme}
          options={themes.map((theme) => ({
            value: theme,
            label: t(`settings.themeOption.${theme}`)
          }))}
          onChange={(theme) => void update({ theme })}
        />
      </div>

      <div className="settings-field">
        {t('settings.accentColor')}
        <div className="accent-swatches">
          {accents.map((accent) => (
            <button
              key={accent}
              className={settings.accentColor === accent ? 'accent-swatch active' : 'accent-swatch'}
              data-accent-preview={accent}
              aria-label={t(`settings.accentOption.${accent}`)}
              title={t(`settings.accentOption.${accent}`)}
              onClick={() => void update({ accentColor: accent })}
            />
          ))}

          {/* Picking a colour selects the custom accent in the same move - having to choose
              a colour and then switch to it would be a step with no purpose. */}
          <label
            className={
              settings.accentColor === 'custom'
                ? 'accent-swatch accent-swatch-custom active'
                : 'accent-swatch accent-swatch-custom'
            }
            style={{ background: settings.accentCustom }}
            title={t('settings.accentCustom')}
          >
            <input
              type="color"
              value={settings.accentCustom}
              onChange={(e) =>
                void update({ accentColor: 'custom', accentCustom: e.target.value })
              }
            />
          </label>
        </div>
      </div>

      <div className="settings-field">
        {t('settings.fontScale')}
        <Segmented
          value={String(settings.fontScale)}
          options={FONT_SCALES.map((scale) => ({
            value: String(scale),
            label: `${Math.round(scale * 100)} %`
          }))}
          onChange={(scale) => void update({ fontScale: Number(scale) })}
        />
        <span className="settings-hint">{t('settings.fontScaleHint')}</span>
      </div>

      <div className="settings-field">
        {t('settings.density')}
        <Segmented
          value={settings.density}
          options={densities.map((density) => ({
            value: density,
            label: t(`settings.densityOption.${density}`)
          }))}
          onChange={(density) => void update({ density })}
        />
      </div>

      <label className="settings-field">
        {t('settings.dateFormat')}
        <select
          value={settings.dateFormat}
          onChange={(e) => void update({ dateFormat: e.target.value as DateFormat })}
        >
          {dateFormats.map((format) => (
            <option key={format} value={format}>
              {t(`settings.dateFormatOption.${format}`)}
            </option>
          ))}
        </select>
      </label>

      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={settings.showPreviewText}
          onChange={(e) => void update({ showPreviewText: e.target.checked })}
        />
        {t('settings.showPreviewText')}
      </label>

      {/* Der Hinweis steht im Label, nicht daneben: Im Raster des Abschnitts würde ein
          Geschwisterelement über die volle Breite laufen und von seinem Kästchen abrücken. */}
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={settings.subjectOnly}
          onChange={(e) => void update({ subjectOnly: e.target.checked })}
        />
        <span>
          {t('settings.subjectOnly')}
          <span className="settings-hint">{t('settings.subjectOnlyHint')}</span>
        </span>
      </label>

      <ThemeEditor />

      <ColumnSettings />
    </section>
  )
}

export default AppearanceSection
