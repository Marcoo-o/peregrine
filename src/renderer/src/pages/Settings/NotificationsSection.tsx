import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@renderer/state/settingsStore'
import { useAccountsStore } from '@renderer/state/accountsStore'
import { parseMutedAccounts, serializeMutedAccounts } from '@peregrine/core/notificationPolicy'

/** What switching quiet hours on means before anything is adjusted. */
const DEFAULT_QUIET = { from: '22:00', to: '07:00' }

function NotificationsSection(): JSX.Element {
  const { t } = useTranslation()
  const { settings, update } = useSettingsStore()
  const { accounts } = useAccountsStore()

  const muted = parseMutedAccounts(settings.notificationMutedAccounts)
  const quietOn = settings.notificationQuietFrom !== '' && settings.notificationQuietTo !== ''

  const setMuted = (accountId: string, silent: boolean): void => {
    const next = silent ? [...muted, accountId] : muted.filter((id) => id !== accountId)
    void update({ notificationMutedAccounts: serializeMutedAccounts(next) })
  }

  return (
    <section className="settings-section">
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={settings.notificationsEnabled}
          onChange={(e) => void update({ notificationsEnabled: e.target.checked })}
        />
        {t('settings.notifications')}
      </label>

      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={settings.notificationPreview}
          disabled={!settings.notificationsEnabled}
          onChange={(e) => void update({ notificationPreview: e.target.checked })}
        />
        {t('notifications.preview')}
      </label>
      <span className="settings-hint">{t('notifications.previewHint')}</span>

      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={quietOn}
          disabled={!settings.notificationsEnabled}
          // Switching on writes the usual night window rather than an empty pair. An
          // unconfigured range would silence nothing and look broken.
          onChange={(e) =>
            void update(
              e.target.checked
                ? { notificationQuietFrom: DEFAULT_QUIET.from, notificationQuietTo: DEFAULT_QUIET.to }
                : { notificationQuietFrom: '', notificationQuietTo: '' }
            )
          }
        />
        {t('notifications.quiet')}
      </label>

      {quietOn && (
        <div className="quiet-range">
          <label className="settings-field">
            {t('notifications.quietFrom')}
            <input
              type="time"
              value={settings.notificationQuietFrom}
              disabled={!settings.notificationsEnabled}
              onChange={(e) => void update({ notificationQuietFrom: e.target.value })}
            />
          </label>
          <label className="settings-field">
            {t('notifications.quietTo')}
            <input
              type="time"
              value={settings.notificationQuietTo}
              disabled={!settings.notificationsEnabled}
              onChange={(e) => void update({ notificationQuietTo: e.target.value })}
            />
          </label>
        </div>
      )}
      <span className="settings-hint">{t('notifications.quietHint')}</span>

      {accounts.length > 1 && (
        <>
          <h3>{t('notifications.perAccount')}</h3>
          <span className="settings-hint">{t('notifications.perAccountHint')}</span>
          <div className="notification-accounts">
            {accounts.map((account) => (
              <label key={account.id} className="checkbox-field">
                <input
                  type="checkbox"
                  checked={!muted.includes(account.id)}
                  disabled={!settings.notificationsEnabled}
                  onChange={(e) => setMuted(account.id, !e.target.checked)}
                />
                <span
                  className="notification-account-dot"
                  style={{ background: account.color }}
                />
                <span>{account.emailAddress}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

export default NotificationsSection
