import { errorText } from '@renderer/util/errorText'
import { useDialog } from '@renderer/util/useDialog'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Download, FileCode2, X } from 'lucide-react'
import type { MessageDetail, MessageSourceResult } from '@peregrine/core/types'
import { toastError, toastInfo } from '@renderer/state/toastStore'
import { formatBytes } from '@renderer/util/format'
import { highlightMailSource } from '@renderer/util/mailSyntax'

interface MessageSourceDialogProps {
  message: MessageDetail
  onClose: () => void
}

/**
 * The message as it actually arrived.
 *
 * Two views of the same thing: the headers as a readable table, and the untouched source.
 * Headers first, because that is what most questions are about. Which server handed the mail
 * over, what the authentication said, where a reply would go.
 */
function MessageSourceDialog({ message, onClose }: MessageSourceDialogProps): JSX.Element {
  const { t, i18n } = useTranslation()
  const [data, setData] = useState<MessageSourceResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'headers' | 'source'>('headers')

  useEffect(() => {
    window.peregrine.messages
      .getSource({ accountId: message.accountId, folderId: message.folderId, uid: message.uid })
      .then(setData)
      .catch((err) => setError(errorText(err)))
  }, [message.id])

  const panelRef = useDialog(onClose)

  async function handleExport(): Promise<void> {
    try {
      const name = `${(message.subject || 'nachricht').replace(/[^\p{L}\p{N} _-]/gu, '_').slice(0, 60)}.eml`
      const { savedPath } = await window.peregrine.messages.exportEml({
        ref: { accountId: message.accountId, folderId: message.folderId, uid: message.uid },
        suggestedName: name
      })
      if (savedPath) toastInfo(t('source.exported'))
    } catch (err) {
      toastError(err, t('source.exportFailed'))
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel source-dialog"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('source.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>
          <FileCode2 size={17} strokeWidth={1.75} />
          {t('source.title')}
          {data && <span className="source-size">{formatBytes(data.sizeBytes, i18n.language)}</span>}
        </h3>

        <div className="source-tabs">
          <button
            className={tab === 'headers' ? 'active' : undefined}
            onClick={() => setTab('headers')}
          >
            {t('source.headers')}
            {data && <span className="source-count">{data.headers.length}</span>}
          </button>
          <button
            className={tab === 'source' ? 'active' : undefined}
            onClick={() => setTab('source')}
          >
            {t('source.raw')}
          </button>
        </div>

        {error && <p className="wizard-error">{error}</p>}
        {!data && !error && <p className="settings-hint">{t('source.loading')}</p>}

        {data && tab === 'headers' && (
          <div className="source-body">
            <table className="header-table">
              <tbody>
                {data.headers.map((header, index) => (
                  // Headers repeat, Received appears once per hop, so the index is part of
                  // the key rather than the name alone.
                  <tr key={`${header.name}-${index}`}>
                    <th>{header.name}</th>
                    <td>{header.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && tab === 'source' && (
          <div className="source-body">
            <pre className="source-raw">
              {highlightMailSource(data.source).map((line, index) => (
                // The index is the key because the line number is what identifies a line
                // here; two identical lines are two lines, not one repeated.
                <div key={index} className={`source-line ${line.kind}`}>
                  <span className="source-line-number">{index + 1}</span>
                  {line.name !== undefined && <span className="source-header-name">{line.name}:</span>}
                  <span className="source-line-text">{line.text}</span>
                </div>
              ))}
            </pre>
          </div>
        )}

        <div className="modal-actions">
          <button onClick={onClose}>
            <X size={14} strokeWidth={1.75} />
            {t('source.close')}
          </button>
          <button
            disabled={!data}
            onClick={() => {
              void navigator.clipboard.writeText(data?.source ?? '')
              toastInfo(t('source.copied'))
            }}
          >
            <Copy size={14} strokeWidth={1.75} />
            {t('source.copy')}
          </button>
          <button className="primary-button" onClick={() => void handleExport()}>
            <Download size={14} strokeWidth={1.75} />
            {t('source.export')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default MessageSourceDialog
