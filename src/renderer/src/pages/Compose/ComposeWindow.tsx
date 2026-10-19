import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ComposeSeed } from '@peregrine/core/types'
import { useAccountsStore } from '@renderer/state/accountsStore'
import { useSettingsStore } from '@renderer/state/settingsStore'
import ComposeEditor from '@renderer/components/ComposeEditor'
import ToastHost from '@renderer/components/ToastHost'

interface ComposeWindowProps {
  seedId: string
}

/**
 * Root of a standalone compose window. It boots its own copy of the accounts and settings
 * stores. The window is a separate renderer process and shares no state with the mailbox.
 */
function ComposeWindow({ seedId }: ComposeWindowProps): JSX.Element {
  const { t } = useTranslation()
  const { accounts, load } = useAccountsStore()
  const [seed, setSeed] = useState<ComposeSeed | null>(null)
  const [accountId, setAccountId] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    void (async () => {
      await Promise.all([load(), useSettingsStore.getState().load()])
      const loaded = await window.peregrine.compose.getSeed({ seedId })
      setSeed(loaded)
      setAccountId(loaded?.accountId ?? null)
      setReady(true)
    })()
  }, [])

  const close = (): void => void window.peregrine.compose.closeWindow()

  if (!ready) return <p className="app-loading">{t('app.loading')}</p>

  const effectiveAccountId = accountId ?? accounts[0]?.id
  if (!effectiveAccountId) return <p className="app-loading">{t('settings.noAccounts')}</p>

  return (
    <div className="compose-window">
      <ComposeEditor
        accountId={effectiveAccountId}
        accounts={accounts}
        initialValues={seed ?? undefined}
        onSent={close}
        onCancel={close}
        onAccountChange={setAccountId}
      />
      <ToastHost />
    </div>
  )
}

export default ComposeWindow
