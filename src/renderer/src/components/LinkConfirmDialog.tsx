import { useTranslation } from 'react-i18next'
import { ExternalLink, ShieldAlert } from 'lucide-react'
import type { LinkAnalysis } from '@peregrine/core/linkSafety'
import { useDialog } from '@renderer/util/useDialog'

interface LinkConfirmDialogProps {
  analysis: LinkAnalysis
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Shown before a link that does not read the way it resolves is opened.
 *
 * The point is to show the destination the way the browser will read it, not the way the
 * message wrote it. The decoded host, spelled out, next to what is off about it. Cancelling
 * is the default action so that a reflexive Enter does not open the link.
 */
function LinkConfirmDialog({ analysis, onConfirm, onCancel }: LinkConfirmDialogProps): JSX.Element {
  const { t } = useTranslation()
  // Escape cancels, in keeping with the rest: the safe answer is the one that costs nothing.
  const panelRef = useDialog(onCancel)

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal-panel link-warning-dialog"
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="link-warning-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="link-warning-title">
          <ShieldAlert size={17} strokeWidth={1.75} />
          {t('links.warningTitle')}
        </h3>

        <ul className="link-warning-findings">
          {analysis.findings.map((finding) => (
            <li key={finding.risk}>
              <strong>{t(`links.risk.${finding.risk}`)}</strong>
              <span>{t(`links.riskDetail.${finding.risk}`, { detail: finding.detail })}</span>
            </li>
          ))}
        </ul>

        <div className="link-warning-target">
          <span className="link-warning-label">{t('links.actualTarget')}</span>
          {/* The decoded host on its own line: in the full URL a lookalike character is
              exactly as invisible as it was in the message. */}
          <code className="link-warning-host">{analysis.displayHost}</code>
          <code className="link-warning-url">{analysis.href}</code>
        </div>

        <div className="modal-actions">
          <button autoFocus onClick={onCancel}>
            {t('links.doNotOpen')}
          </button>
          <button className="danger-button" onClick={onConfirm}>
            <ExternalLink size={14} strokeWidth={1.75} />
            {t('links.openAnyway')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default LinkConfirmDialog
