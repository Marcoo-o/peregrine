import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, ShieldAlert } from 'lucide-react'
import type { LinkAnalysis, SenderFinding } from '@peregrine/core/linkSafety'
import type { SpamAssessment } from '@peregrine/core/spamScore'

interface SuspiciousBannerProps {
  senderFindings: SenderFinding[]
  linkAnalyses: LinkAnalysis[]
  /** SPF/DKIM/DMARC checks the receiving server reported as failed. */
  failedAuth: string[]
  /** Number of 1×1 images. Loading one tells the sender the message was opened. */
  trackingPixels: number
  /** Nothing has ever arrived from this address before. */
  firstContact: boolean
  /** The delivering server's own spam verdict, where it left one. */
  spam: SpamAssessment | null
}

/**
 * States what is off about a message, before its content gets a chance to be persuasive.
 *
 * Collapsed by default down to a single line: the detail matters once someone is deciding
 * whether to click, and a wall of technical findings at the top of every borderline message
 * trains people to scroll past the warning.
 */
function SuspiciousBanner({
  senderFindings,
  linkAnalyses,
  failedAuth,
  trackingPixels,
  firstContact,
  spam
}: SuspiciousBannerProps): JSX.Element | null {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  // A clean verdict is not a finding. Saying "the filter was happy" on every ordinary message
  // is how a warning area becomes furniture that nobody reads any more.
  const spamFinding = spam && spam.verdict !== 'clean' ? spam : null

  const linkCount = linkAnalyses.length
  if (
    senderFindings.length === 0 &&
    linkCount === 0 &&
    failedAuth.length === 0 &&
    trackingPixels === 0 &&
    !firstContact &&
    !spamFinding
  ) {
    return null
  }

  // A failed authentication outranks everything else: it is the server stating the sender is
  // forged, not an observation that something reads oddly. A filter that called the message
  // spam outright comes next, for the same reason: it is a verdict, not a hint.
  const summary =
    failedAuth.length > 0
      ? t('links.bannerAuth')
      : spamFinding?.verdict === 'spam'
        ? t('spam.bannerSpam')
        : senderFindings.length > 0 && linkCount > 0
          ? t('links.bannerBoth', { count: linkCount })
          : senderFindings.length > 0
            ? t('links.bannerSender')
            : linkCount > 0
              ? t('links.bannerLinks', { count: linkCount })
              : trackingPixels > 0
                ? t('links.bannerPixels', { count: trackingPixels })
                : firstContact
                  ? t('links.bannerFirstContact')
                  : t('spam.bannerBorderline')

  const severe = failedAuth.length > 0 || spamFinding?.verdict === 'spam'

  return (
    <div className={severe ? 'suspicious-banner severe' : 'suspicious-banner'}>
      <button
        className="suspicious-banner-head"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <ShieldAlert size={15} strokeWidth={1.75} />
        <span>{summary}</span>
        {expanded ? (
          <ChevronDown size={14} strokeWidth={1.75} />
        ) : (
          <ChevronRight size={14} strokeWidth={1.75} />
        )}
      </button>

      {expanded && (
        <div className="suspicious-banner-detail">
          {failedAuth.length > 0 && (
            <>
              <h4>{t('links.authHeading')}</h4>
              <ul>
                {failedAuth.map((check) => (
                  <li key={check}>
                    <strong>{t(`links.authCheck.${check}`)}</strong>
                    <span>{t(`links.authFailed.${check}`)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {spamFinding && (
            <>
              <h4>{t('spam.heading')}</h4>
              <ul>
                <li>
                  {/* The raw numbers, because every filter counts differently and a bare
                      "8.4" means nothing without the limit it was measured against. */}
                  <strong>
                    {t(`spam.source.${spamFinding.source}`)}
                    {spamFinding.source !== 'flag' &&
                      ` · ${spamFinding.score} / ${spamFinding.threshold}`}
                  </strong>
                  <span>{t(`spam.detail.${spamFinding.verdict}`)}</span>
                </li>
                {/* The filter's own names for what it found. Untranslated on purpose: they
                    are identifiers, and a reader looking one up needs the original. */}
                {spamFinding.symbols.slice(0, 5).map((symbol) => (
                  <li key={symbol.name}>
                    <code>{symbol.name}</code>
                    {symbol.score > 0 && <span>+{symbol.score}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}

          {firstContact && (
            <>
              <h4>{t('links.contactHeading')}</h4>
              <ul>
                <li>
                  <span>{t('links.firstContactDetail')}</span>
                </li>
              </ul>
            </>
          )}

          {trackingPixels > 0 && (
            <>
              <h4>{t('links.pixelHeading')}</h4>
              <ul>
                <li>
                  <span>{t('links.pixelDetail', { count: trackingPixels })}</span>
                </li>
              </ul>
            </>
          )}

          {senderFindings.length > 0 && (
            <>
              <h4>{t('links.senderHeading')}</h4>
              <ul>
                {senderFindings.map((finding) => (
                  <li key={finding.risk}>
                    <strong>{t(`links.senderRisk.${finding.risk}`)}</strong>
                    <code>{finding.detail}</code>
                  </li>
                ))}
              </ul>
            </>
          )}

          {linkCount > 0 && (
            <>
              <h4>{t('links.linksHeading')}</h4>
              <ul>
                {linkAnalyses.map((analysis) => (
                  <li key={analysis.href}>
                    <code className="link-warning-host">{analysis.displayHost}</code>
                    <span>
                      {analysis.findings.map((f) => t(`links.risk.${f.risk}`)).join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default SuspiciousBanner
