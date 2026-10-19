import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Lock, LockOpen, LogOut, UserPlus } from 'lucide-react'
import type { ProfileSummary } from '@peregrine/core/types'
import { toastError, toastInfo } from '@renderer/state/toastStore'
import { useSettingsStore } from '@renderer/state/settingsStore'

/** Idle minutes before an encrypted profile locks itself again; 0 switches it off. */
const AUTO_LOCK_OPTIONS = [0, 5, 15, 30, 60]

/**
 * The open profile: its name, and whether it is encrypted.
 *
 * A password is never required. Switching it on encrypts the database in place, switching it
 * off decrypts it again. Both work at any time, and the choice is the user's rather than
 * something the app insists on.
 */
function ProfileSection(): JSX.Element {
  const { t } = useTranslation()
  const autoLockMinutes = useSettingsStore((s) => s.settings.autoLockMinutes)
  const updateSettings = useSettingsStore((s) => s.update)
  const [profile, setProfile] = useState<ProfileSummary | null>(null)
  const [name, setName] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Fields for a further profile, kept apart from the ones for the open one. */
  const [newName, setNewName] = useState('')
  const [newProfilePassword, setNewProfilePassword] = useState('')
  const [created, setCreated] = useState<string | null>(null)
  const [others, setOthers] = useState<ProfileSummary[]>([])

  async function reloadProfiles(currentId: string | undefined): Promise<void> {
    const all = await window.peregrine.profiles.listAll()
    setOthers(all.filter((p) => p.id !== currentId))
  }

  useEffect(() => {
    void window.peregrine.profiles.current().then((current) => {
      setProfile(current)
      setName(current?.name ?? '')
      void reloadProfiles(current?.id)
    })
  }, [])

  async function handleCreate(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const result = await window.peregrine.profiles.createNew({
        name: newName.trim(),
        password: newProfilePassword
      })
      if ('error' in result) {
        setError(t('profile.nameTaken'))
        return
      }
      setCreated(result.name)
      setNewName('')
      setNewProfilePassword('')
      await reloadProfiles(profile?.id)
      toastInfo(t('profile.created', { name: result.name }))
    } catch (err) {
      toastError(err, t('profile.createFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function handleRename(): Promise<void> {
    if (name.trim() === '') return
    await window.peregrine.profiles.rename({ name: name.trim() })
    toastInfo(t('profile.renamed'))
  }

  async function applyPassword(password: string): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const result = await window.peregrine.profiles.setPassword({
        currentPassword,
        newPassword: password
      })
      if (!result.ok) {
        setError(t(`unlock.error.${result.reason ?? 'openFailed'}`))
        return
      }
      setProfile((prev) => (prev ? { ...prev, encrypted: password !== '' } : prev))
      setCurrentPassword('')
      setNewPassword('')
      setRepeat('')
      toastInfo(password === '' ? t('profile.passwordRemoved') : t('profile.passwordSet'))
    } catch (err) {
      toastError(err, t('profile.passwordFailed'))
    } finally {
      setBusy(false)
    }
  }

  if (!profile) return <section className="settings-section" />

  return (
    <section className="settings-section">
      <h3>{t('profile.title')}</h3>

      <label className="settings-field">
        {t('profile.name')}
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => void handleRename()} />
      </label>

      <div className="settings-field">
        <span className="profile-state">
          {profile.encrypted ? (
            <>
              <Lock size={14} strokeWidth={1.75} />
              {t('profile.encrypted')}
            </>
          ) : (
            <>
              <LockOpen size={14} strokeWidth={1.75} />
              {t('profile.notEncrypted')}
            </>
          )}
        </span>
        <span className="settings-hint">
          {profile.encrypted ? t('profile.encryptedHint') : t('profile.notEncryptedHint')}
        </span>
      </div>

      {profile.encrypted && (
        <label className="settings-field">
          {t('profile.currentPassword')}
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </label>
      )}

      <label className="settings-field">
        {profile.encrypted ? t('profile.newPassword') : t('profile.setPassword')}
        <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
      </label>

      <label className="settings-field">
        {t('unlock.passwordRepeat')}
        <input type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
      </label>

      {!profile.encrypted && <p className="unlock-warning">{t('unlock.passwordWarning')}</p>}
      {error && <p className="wizard-error">{error}</p>}

      {/* Only where it protects something: locking an unencrypted profile would close a
          door anyone can walk straight back through. */}
      {profile.encrypted && (
        <label className="settings-field">
          {t('profile.autoLock')}
          <select
            value={String(autoLockMinutes)}
            onChange={(e) => void updateSettings({ autoLockMinutes: Number(e.target.value) })}
          >
            {AUTO_LOCK_OPTIONS.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes === 0
                  ? t('profile.autoLockOff')
                  : t('profile.autoLockMinutes', { count: minutes })}
              </option>
            ))}
          </select>
          <span className="settings-hint">{t('profile.autoLockHint')}</span>
        </label>
      )}

      <div className="settings-inline-row">
        <button onClick={() => void window.peregrine.profiles.lock()}>
          <LogOut size={14} strokeWidth={1.75} />
          {t('profile.switchProfile')}
        </button>
      </div>

      {/* Creating a profile used to be possible only in the chooser at startup, which meant
          quitting the application to set one up for someone else. */}
      <h3>{t('profile.newHeading')}</h3>
      <p className="settings-hint">{t('profile.newHint')}</p>
      {/* Said before it happens, not discovered at the next start. */}
      <p className="settings-hint">{t('profile.newChooserHint')}</p>

      {others.length > 0 && (
        <p className="settings-hint">
          {t('profile.existing', { names: others.map((p) => p.name).join(', ') })}
        </p>
      )}

      <label className="settings-field">
        {t('profile.newName')}
        <input value={newName} onChange={(e) => setNewName(e.target.value)} />
      </label>

      <label className="settings-field">
        {t('profile.newProfilePassword')}
        <input
          type="password"
          value={newProfilePassword}
          onChange={(e) => setNewProfilePassword(e.target.value)}
        />
        <span className="settings-hint">{t('profile.newPasswordHint')}</span>
      </label>

      <div className="settings-inline-row">
        <button disabled={busy || newName.trim() === ''} onClick={() => void handleCreate()}>
          <UserPlus size={14} strokeWidth={1.75} />
          {t('profile.createProfile')}
        </button>
        {created && (
          <button className="primary-button" onClick={() => void window.peregrine.profiles.lock()}>
            <LogOut size={14} strokeWidth={1.75} />
            {t('profile.switchToNew', { name: created })}
          </button>
        )}
      </div>

      <div className="settings-inline-row">
        <button
          className="primary-button"
          disabled={busy || newPassword === '' || newPassword !== repeat}
          onClick={() => void applyPassword(newPassword)}
        >
          <Lock size={14} strokeWidth={1.75} />
          {profile.encrypted ? t('profile.changePassword') : t('profile.enablePassword')}
        </button>

        {/* Removing it is offered just as plainly as setting it - the whole point is that
            this stays the user's choice, not a door that only opens one way. */}
        {profile.encrypted && (
          <button
            disabled={busy || currentPassword === ''}
            onClick={() => {
              if (!window.confirm(t('profile.confirmRemovePassword'))) return
              void applyPassword('')
            }}
          >
            <LockOpen size={14} strokeWidth={1.75} />
            {t('profile.removePassword')}
          </button>
        )}
      </div>
    </section>
  )
}

export default ProfileSection
