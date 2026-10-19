import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { SETTINGS_GROUPS, SETTINGS_SECTIONS } from './sections'

interface SettingsProps {
  onBack: () => void
  onAddAccount: () => void
}

function Settings({ onBack, onAddAccount }: SettingsProps): JSX.Element {
  const { t } = useTranslation()
  const [activeId, setActiveId] = useState(SETTINGS_SECTIONS[0].id)

  const active = SETTINGS_SECTIONS.find((section) => section.id === activeId) ?? SETTINGS_SECTIONS[0]

  return (
    <div className="settings-shell">
      {/*
        Eigene Kopfleiste, wie in der Postfachansicht: Das Fenster hat keine native Titelleiste
        mehr, also braucht jede Vollbildansicht einen Streifen, an dem es sich verschieben lässt
        und in dem rechts Platz für die Fensterknöpfe bleibt.
      */}
      <header className="settings-topbar">
        <button className="settings-back" onClick={onBack}>
          <ArrowLeft size={15} strokeWidth={1.75} />
          {t('settings.back')}
        </button>
        <h2>{t('settings.title')}</h2>
      </header>

      <aside className="settings-nav">
        {SETTINGS_GROUPS.map((group) => {
          const sections = SETTINGS_SECTIONS.filter((section) => section.group === group.id)
          if (sections.length === 0) return null
          return (
            <div className="settings-nav-group" key={group.id}>
              <h3>{t(group.labelKey)}</h3>
              {sections.map((section) => {
                const Icon = section.icon
                return (
                  <button
                    key={section.id}
                    className={
                      section.id === active.id ? 'settings-nav-item active' : 'settings-nav-item'
                    }
                    onClick={() => setActiveId(section.id)}
                  >
                    <Icon size={15} strokeWidth={1.75} />
                    {t(section.labelKey)}
                  </button>
                )
              })}
            </div>
          )
        })}
      </aside>

      <div className="settings-content">{active.render({ onAddAccount })}</div>
    </div>
  )
}

export default Settings
