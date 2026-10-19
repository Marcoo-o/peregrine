import { Mail, Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { providerPresets, type ProviderPreset } from './providerPresets'

interface ProviderPickerProps {
  onPick: (preset: ProviderPreset) => void
  onManual: () => void
}

/** Distinct tile colors so the grid stays scannable at a glance, not brand logos. */
const tileColors: Record<string, string> = {
  gmail: '#ea4335',
  outlook: '#0a66c2',
  yahoo: '#6001d2',
  icloud: '#3693f3',
  gmx: '#1c449b',
  webde: '#ffce00'
}

function ProviderPicker({ onPick, onManual }: ProviderPickerProps): JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="account-wizard">
      <h2>{t('wizard.chooseProvider')}</h2>
      <p className="wizard-hint">{t('wizard.providerPickerHint')}</p>

      <div className="provider-grid">
        {providerPresets.map((preset) => (
          <button key={preset.id} className="provider-tile" onClick={() => onPick(preset)}>
            <span className="provider-tile-icon" style={{ background: tileColors[preset.id] }}>
              <Mail size={18} strokeWidth={1.75} />
            </span>
            {preset.label}
          </button>
        ))}
        <button className="provider-tile" onClick={onManual}>
          <span className="provider-tile-icon provider-tile-icon-manual">
            <Wrench size={18} strokeWidth={1.75} />
          </span>
          {t('wizard.manualSetup')}
        </button>
      </div>
    </div>
  )
}

export default ProviderPicker
