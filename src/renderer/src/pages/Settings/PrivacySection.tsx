import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@renderer/state/settingsStore'
import { toastError } from '@renderer/state/toastStore'
import { formatBytes } from '@renderer/util/format'

function PrivacySection(): JSX.Element {
  const { t, i18n } = useTranslation()
  const { settings, update } = useSettingsStore()
  const [cacheBytes, setCacheBytes] = useState<number | null>(null)
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    window.peregrine.attachments.cacheInfo().then(({ sizeBytes }) => setCacheBytes(sizeBytes))
  }, [])

  async function handleClearCache(): Promise<void> {
    setClearing(true)
    try {
      await window.peregrine.attachments.clearCache()
      const { sizeBytes } = await window.peregrine.attachments.cacheInfo()
      setCacheBytes(sizeBytes)
    } catch (err) {
      toastError(err, t('settings.clearCacheFailed'))
    } finally {
      setClearing(false)
    }
  }

  return (
    <section className="settings-section">
      <h3>{t('settings.sections.privacy')}</h3>

      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={settings.blockRemoteImages}
          onChange={(e) => void update({ blockRemoteImages: e.target.checked })}
        />
        {t('settings.blockRemoteImages')}
      </label>
      <span className="settings-hint">{t('settings.blockRemoteImagesHint')}</span>

      <h4 className="settings-subheading">{t('settings.deceptionHeading')}</h4>

      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={settings.warnSuspiciousLinks}
          onChange={(e) => void update({ warnSuspiciousLinks: e.target.checked })}
        />
        {t('settings.warnSuspiciousLinks')}
      </label>
      <span className="settings-hint">{t('settings.warnSuspiciousLinksHint')}</span>

      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={settings.confirmAllLinks}
          onChange={(e) => void update({ confirmAllLinks: e.target.checked })}
        />
        {t('settings.confirmAllLinks')}
      </label>
      <span className="settings-hint">{t('settings.confirmAllLinksHint')}</span>

      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={settings.warnRiskyAttachments}
          onChange={(e) => void update({ warnRiskyAttachments: e.target.checked })}
        />
        {t('settings.warnRiskyAttachments')}
      </label>
      <span className="settings-hint">{t('settings.warnRiskyAttachmentsHint')}</span>

      <div className="settings-field">
        {t('settings.attachmentCache')}
        <div className="settings-inline-row">
          <span>
            {cacheBytes == null
              ? '…'
              : cacheBytes === 0
                ? t('settings.cacheEmpty')
                : formatBytes(cacheBytes, i18n.language)}
          </span>
          <button onClick={handleClearCache} disabled={clearing || !cacheBytes}>
            {t('settings.clearCache')}
          </button>
        </div>
        <span className="settings-hint">{t('settings.attachmentCacheHint')}</span>
      </div>
    </section>
  )
}

export default PrivacySection
