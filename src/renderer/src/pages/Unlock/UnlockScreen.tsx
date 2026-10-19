import { errorText } from '@renderer/util/errorText'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyRound, Lock, Plus, Trash2, Unlock, User } from 'lucide-react'
import type { ProfileSummary } from '@peregrine/core/types'

/**
 * The screen in front of everything else.
 *
 * Its only job is to get a password to the main process. The password never travels further:
 * it is turned into the database key there and dropped. Nothing about the mail is reachable
 * from here, because at this point no database is open.
 */
function UnlockScreen(): JSX.Element {
  const { t } = useTranslation()
  const [profiles, setProfiles] = useState<ProfileSummary[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordRepeat, setNewPasswordRepeat] = useState('')
  const passwordRef = useRef<HTMLInputElement>(null)

  async function reload(): Promise<ProfileSummary[]> {
    const list = await window.peregrine.profiles.list()
    setProfiles(list)
    setSelectedId((current) => current ?? list[0]?.id ?? null)
    return list
  }

  useEffect(() => {
    void reload()
  }, [])

  const selected = profiles?.find((p) => p.id === selectedId) ?? null

  useEffect(() => {
    setPassword('')
    setError(null)
    passwordRef.current?.focus()
  }, [selectedId])

  async function handleUnlock(): Promise<void> {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.peregrine.profiles.unlock({
        profileId: selected.id,
        password
      })
      // On success this window is closed by the main process; nothing more to do here.
      if (!result.ok) {
        setError(t(`unlock.error.${result.reason}`))
        setPassword('')
        passwordRef.current?.focus()
      }
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleCreate(): Promise<void> {
    if (newName.trim() === '') return
    if (newPassword !== newPasswordRepeat) {
      setError(t('unlock.error.passwordMismatch'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const created = await window.peregrine.profiles.create({
        name: newName.trim(),
        password: newPassword
      })
      await reload()
      setSelectedId(created.id)
      setCreating(false)
      setNewName('')
      setNewPassword('')
      setNewPasswordRepeat('')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(profile: ProfileSummary): Promise<void> {
    if (!window.confirm(t('unlock.confirmDelete', { name: profile.name }))) return
    await window.peregrine.profiles.delete(profile.id)
    const list = await reload()
    setSelectedId(list[0]?.id ?? null)
  }

  if (profiles == null) {
    return <p className="app-loading">{t('app.loading')}</p>
  }

  return (
    <div className="unlock-shell">
      <h1 className="unlock-title">Peregrine</h1>

      {creating ? (
        <div className="unlock-panel">
          <h2>{t('unlock.newProfile')}</h2>
          <input
            autoFocus
            placeholder={t('unlock.profileName')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            type="password"
            placeholder={t('unlock.passwordOptional')}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <input
            type="password"
            placeholder={t('unlock.passwordRepeat')}
            value={newPasswordRepeat}
            onChange={(e) => setNewPasswordRepeat(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleCreate()}
          />
          {/* Said plainly and up front: there is no recovery, because a recoverable key would
              mean the encryption could be bypassed. */}
          <p className="unlock-warning">{t('unlock.passwordWarning')}</p>
          {error && <p className="wizard-error">{error}</p>}
          <div className="unlock-actions">
            <button onClick={() => setCreating(false)} disabled={busy}>
              {t('unlock.cancel')}
            </button>
            <button className="primary-button" onClick={() => void handleCreate()} disabled={busy}>
              {t('unlock.create')}
            </button>
          </div>
        </div>
      ) : (
        <div className="unlock-panel">
          <ul className="unlock-profile-list">
            {profiles.map((profile) => (
              <li key={profile.id}>
                <button
                  className={profile.id === selectedId ? 'unlock-profile active' : 'unlock-profile'}
                  onClick={() => setSelectedId(profile.id)}
                >
                  <User size={15} strokeWidth={1.75} />
                  <span className="unlock-profile-name">{profile.name}</span>
                  {profile.encrypted && <Lock size={13} strokeWidth={1.75} />}
                </button>
                <button
                  className="icon-button"
                  onClick={() => void handleDelete(profile)}
                  aria-label={t('unlock.deleteProfile')}
                  title={t('unlock.deleteProfile')}
                >
                  <Trash2 size={14} strokeWidth={1.75} />
                </button>
              </li>
            ))}
          </ul>

          {selected?.encrypted && (
            <input
              ref={passwordRef}
              type="password"
              autoFocus
              placeholder={t('unlock.password')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void handleUnlock()}
            />
          )}

          {error && <p className="wizard-error">{error}</p>}

          <div className="unlock-actions">
            <button onClick={() => setCreating(true)} disabled={busy}>
              <Plus size={14} strokeWidth={1.75} />
              {t('unlock.newProfile')}
            </button>
            <button
              className="primary-button"
              onClick={() => void handleUnlock()}
              disabled={busy || !selected || (selected.encrypted && password === '')}
            >
              {selected?.encrypted ? (
                <KeyRound size={14} strokeWidth={1.75} />
              ) : (
                <Unlock size={14} strokeWidth={1.75} />
              )}
              {busy ? t('unlock.unlocking') : t('unlock.open')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default UnlockScreen
