import { useTranslation } from 'react-i18next'
import type { ConnectionState } from '@peregrine/core/types'

interface ConnectionIndicatorProps {
  state: ConnectionState | undefined
}

const stateClass: Record<ConnectionState, string> = {
  connected: 'connection-dot connected',
  connecting: 'connection-dot connecting',
  reconnecting: 'connection-dot connecting',
  error: 'connection-dot error'
}

function ConnectionIndicator({ state }: ConnectionIndicatorProps): JSX.Element {
  const { t } = useTranslation()
  const resolved = state ?? 'connecting'
  return (
    // A span with a label but no role is skipped by most screen readers, so the state was
    // carried by colour alone. Deliberately not a live region: twelve accounts reconnecting
    // at once would talk over everything else, and this is a thing to look up, not an alarm.
    <span
      className={stateClass[resolved]}
      role="img"
      title={t(`settings.connectionState.${resolved}`)}
      aria-label={t(`settings.connectionState.${resolved}`)}
    />
  )
}

export default ConnectionIndicator
