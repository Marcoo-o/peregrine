import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Trash2 } from 'lucide-react'
import type { ProtocolLogState } from '@peregrine/core/types'
import { useSettingsStore } from '@renderer/state/settingsStore'
import { toastError, toastInfo } from '@renderer/state/toastStore'

/**
 * How often the view catches up while recording.
 *
 * Polled rather than pushed: an event per protocol line would mean thousands of IPC messages
 * during a sync, all to redraw a list nobody can read that fast.
 */
const POLL_MS = 700

const EMPTY: ProtocolLogState = { recording: false, verbose: false, entries: [] }

function DiagnosticsSection(): JSX.Element {
  const { t } = useTranslation()
  const { settings, update } = useSettingsStore()
  const [state, setState] = useState<ProtocolLogState>(EMPTY)
  const [follow, setFollow] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.peregrine.diagnostics.get().then(setState)
  }, [])

  useEffect(() => {
    if (!state.recording) return
    const handle = setInterval(() => {
      void window.peregrine.diagnostics.get().then(setState)
    }, POLL_MS)
    return () => clearInterval(handle)
  }, [state.recording])

  useEffect(() => {
    if (follow) bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [state.entries.length, follow])

  async function handleExport(): Promise<void> {
    try {
      const { savedPath } = await window.peregrine.diagnostics.export()
      if (savedPath) toastInfo(t('diagnostics.exported'))
    } catch (err) {
      toastError(err, t('diagnostics.exportFailed'))
    }
  }

  return (
    <section className="settings-section">
      <h3>{t('settings.sections.diagnostics')}</h3>
      <p className="settings-hint">{t('diagnostics.intro')}</p>

      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={settings.experimentalImapClient}
          onChange={(e) => void update({ experimentalImapClient: e.target.checked })}
        />
        {t('diagnostics.ownClient')}
      </label>
      <span className="settings-hint">{t('diagnostics.ownClientHint')}</span>

      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={state.recording}
          onChange={(e) =>
            void window.peregrine.diagnostics.setRecording(e.target.checked).then(setState)
          }
        />
        {t('diagnostics.record')}
      </label>
      <span className="settings-hint">{t('diagnostics.recordHint')}</span>

      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={state.verbose}
          onChange={(e) =>
            void window.peregrine.diagnostics.setVerbose(e.target.checked).then(setState)
          }
        />
        {t('diagnostics.verbose')}
      </label>
      <span className="settings-hint">{t('diagnostics.verboseHint')}</span>

      <label className="checkbox-field">
        <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
        {t('diagnostics.follow')}
      </label>

      <div className="diagnostics-toolbar">
        <span className="settings-hint">
          {t('diagnostics.entryCount', { count: state.entries.length })}
        </span>
        <button onClick={() => void window.peregrine.diagnostics.clear().then(setState)}>
          <Trash2 size={14} strokeWidth={1.75} />
          {t('diagnostics.clear')}
        </button>
        <button onClick={() => void handleExport()} disabled={state.entries.length === 0}>
          <Download size={14} strokeWidth={1.75} />
          {t('diagnostics.export')}
        </button>
      </div>

      {state.entries.length === 0 ? (
        <p className="settings-hint">
          {state.recording ? t('diagnostics.waiting') : t('diagnostics.empty')}
        </p>
      ) : (
        <div className="protocol-log">
          {state.entries.map((entry) => (
            <div key={entry.seq} className="protocol-row" data-source={entry.source}>
              {/* The gap, not the clock: a slow refresh is round trips, not data. */}
              <span className="protocol-delta">
                {entry.deltaMs > 0 ? `+${entry.deltaMs} ms` : ''}
              </span>
              <span className="protocol-connection">{entry.connection}</span>
              <span className="protocol-text">{entry.text}</span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </section>
  )
}

export default DiagnosticsSection
