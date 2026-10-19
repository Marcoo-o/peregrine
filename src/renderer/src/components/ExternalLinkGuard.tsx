import { useEffect, useState } from 'react'
import { analyzeLink, type LinkAnalysis } from '@peregrine/core/linkSafety'
import { useSettingsStore } from '@renderer/state/settingsStore'
import LinkConfirmDialog from './LinkConfirmDialog'

/**
 * Sits between a clicked link and the browser.
 *
 * The main process refuses to open links itself and reports them here instead, because this
 * is the only place that can both examine the address and show the result. A link with
 * nothing wrong with it opens straight away. A check that interrupts every time gets clicked
 * away without being read, and then it protects nobody.
 */
function ExternalLinkGuard(): JSX.Element | null {
  const warnSuspiciousLinks = useSettingsStore((s) => s.settings.warnSuspiciousLinks)
  const confirmAllLinks = useSettingsStore((s) => s.settings.confirmAllLinks)
  const [pending, setPending] = useState<LinkAnalysis | null>(null)

  useEffect(() => {
    return window.peregrine.events.onLinkActivated(({ url }) => {
      const analysis = analyzeLink(url)
      const suspicious = warnSuspiciousLinks && analysis.findings.length > 0
      if (suspicious || confirmAllLinks) {
        setPending(analysis)
        return
      }
      void window.peregrine.links.openExternal(url)
    })
  }, [warnSuspiciousLinks, confirmAllLinks])

  if (!pending) return null

  return (
    <LinkConfirmDialog
      analysis={pending}
      onCancel={() => setPending(null)}
      onConfirm={() => {
        void window.peregrine.links.openExternal(pending.href)
        setPending(null)
      }}
    />
  )
}

export default ExternalLinkGuard
