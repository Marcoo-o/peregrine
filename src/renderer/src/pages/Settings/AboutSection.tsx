import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Info } from 'lucide-react'
import type { AppVersionInfo } from '@peregrine/core/types'
import { toastError, toastInfo } from '@renderer/state/toastStore'

/**
 * Which build is actually running.
 *
 * This was written down nowhere before. Anyone describing a fault could not say which version
 * showed it, and two installations could not be told apart. The values are therefore also
 * offered as a block to copy. Version numbers typed by hand are wrong half the time, and
 * nobody copies out the underpinnings such as Electron and Chromium at all.
 */
function AboutSection(): JSX.Element {
  const { t } = useTranslation()
  const [info, setInfo] = useState<AppVersionInfo | null>(null)

  useEffect(() => {
    void window.peregrine.appVersion().then(setInfo)
  }, [])

  if (!info) return <section className="settings-section" />

  const zeilen = [
    `Peregrine ${info.version}${info.packaged ? '' : ' (Entwicklungsbetrieb)'}`,
    `Electron ${info.electron}`,
    `Chromium ${info.chromium}`,
    `Node ${info.node}`
  ]

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(zeilen.join('\n'))
      toastInfo(t('about.copied'))
    } catch (err) {
      toastError(err, t('about.copyFailed'))
    }
  }

  return (
    <section className="settings-section">
      <h3>{t('settings.sections.about')}</h3>

      <div className="about-identity">
        <div className="about-name">Peregrine</div>
        <div className="about-version">
          {t('about.version', { version: info.version })}
          {/* Nur im Entwicklungsbetrieb sichtbar - dort ist es die Erklärung dafür, dass sich
              etwas anders verhält als in der installierten Fassung. */}
          {!info.packaged && <span className="about-badge">{t('about.development')}</span>}
        </div>
      </div>

      <dl className="about-facts">
        <dt>Electron</dt>
        <dd>{info.electron}</dd>
        <dt>Chromium</dt>
        <dd>{info.chromium}</dd>
        <dt>Node</dt>
        <dd>{info.node}</dd>
      </dl>

      <button className="about-copy" onClick={() => void copy()}>
        <Copy size={15} strokeWidth={1.75} />
        {t('about.copy')}
      </button>

      <p className="settings-hint about-updates">
        <Info size={13} strokeWidth={2} />
        {t('about.noUpdates')}
      </p>
    </section>
  )
}

export default AboutSection
