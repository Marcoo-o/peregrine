import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PeregrineApi } from '@shared/preloadApi'
import { useAccountsStore } from './state/accountsStore'
import { useConnectionStore } from './state/connectionStore'
import { useMailboxStore } from './state/mailboxStore'
import { useSettingsStore } from './state/settingsStore'
import AccountSetupWizard from './pages/AccountSetupWizard/AccountSetupWizard'
import Mailbox from './pages/Mailbox/Mailbox'
import Settings from './pages/Settings/Settings'
import ComposeWindow from './pages/Compose/ComposeWindow'
import ToastHost from './components/ToastHost'
import UnlockScreen from './pages/Unlock/UnlockScreen'
import ExternalLinkGuard from './components/ExternalLinkGuard'
import PromptDialog from './components/PromptDialog'
import IdleLock from './components/IdleLock'

declare global {
  interface Window {
    peregrine: PeregrineApi
  }
}

type View = 'mailbox' | 'settings'

/** Compose windows load the same bundle and identify themselves through the URL hash. */
function composeSeedId(): string | null {
  const match = /^#compose=(.+)$/.exec(window.location.hash)
  return match ? match[1] : null
}

function App(): JSX.Element {
  const { t } = useTranslation()
  const { accounts, loading, load } = useAccountsStore()
  const [showWizard, setShowWizard] = useState(false)
  const [view, setView] = useState<View>('mailbox')
  const seedId = composeSeedId()
  const isUnlockWindow = window.location.hash === '#unlock'
  const [profileEncrypted, setProfileEncrypted] = useState(false)

  useEffect(() => {
    if (seedId || isUnlockWindow) return
    void load()
    // The mailbox store is created before the stored settings arrive, so the persisted sort
    // order has to be handed over once they do.
    void useSettingsStore
      .getState()
      .load()
      .then(() => {
        const { sortField, sortDirection } = useSettingsStore.getState().settings
        useMailboxStore.setState({ sort: { field: sortField, direction: sortDirection } })
      })
  }, [])

  useEffect(() => {
    if (seedId || isUnlockWindow) return
    return useConnectionStore.getState().subscribe()
  }, [])

  useEffect(() => {
    if (seedId || isUnlockWindow) return
    void window.peregrine.profiles.current().then((p) => setProfileEncrypted(p?.encrypted ?? false))
  }, [])

  // The unlock window runs before any database exists, so it must not touch anything that
  // would reach for one.
  if (isUnlockWindow) return <UnlockScreen />

  // A compose window renders nothing of the mailbox: it is its own top-level screen. But it
  // quotes mail, so its links have to pass the same check.
  if (seedId) {
    return (
      <>
        <ComposeWindow seedId={seedId} />
        <ExternalLinkGuard />
        <PromptDialog />
      </>
    )
  }

  if (loading) {
    return <p className="app-loading">{t('app.loading')}</p>
  }

  if (accounts.length === 0 || showWizard) {
    return (
      <AccountSetupWizard
        onCreated={() => {
          setShowWizard(false)
          setView('mailbox')
          void load()
        }}
        onCancel={() => setShowWizard(false)}
      />
    )
  }

  if (view === 'settings') {
    return (
      <div className="app-shell">
        <Settings onBack={() => setView('mailbox')} onAddAccount={() => setShowWizard(true)} />
        <ToastHost />
        <PromptDialog />
      </div>
    )
  }

  return (
    <div className="app-shell">
      <Mailbox onOpenSettings={() => setView('settings')} />
      <ToastHost />
      <ExternalLinkGuard />
      <PromptDialog />
      <IdleLock enabled={profileEncrypted} />
    </div>
  )
}

export default App
