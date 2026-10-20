import type { PendingSummary } from '@peregrine/core/pendingActions'
import type { Services } from './services'
import type { AppState, AppStore } from './store'

/** Reads what waits in the queue into the store, for the account the status line speaks of. */
export async function refreshQueueStatus(services: Pick<Services, 'mail'>, store: AppStore): Promise<void> {
  const { statusAccountId } = store.state
  const summary = await services.mail.waiting()
  const problem = statusAccountId ? await services.mail.lastProblem(statusAccountId) : null
  store.setWaiting({ summary, problem })
}

/** Gives up on what failed too often, which the user does after reading why it did, and reads what is left. */
export async function discardFailedActions(services: Pick<Services, 'mail'>, store: AppStore): Promise<void> {
  await services.mail.discardFailed()
  await refreshQueueStatus(services, store)
}

/** The sentence about the actions that wait, or null when none does. */
export function waitingText(summary: PendingSummary): string | null {
  const open = summary.total - summary.failed
  if (open <= 0) return null
  return open === 1 ? '1 Aktion wartet' : `${open} Aktionen warten`
}

/** The sentence about the actions that were given up on, or null when none was. */
export function failedText(summary: PendingSummary): string | null {
  if (summary.failed === 0) return null
  return summary.failed === 1 ? '1 Aktion ist fehlgeschlagen.' : `${summary.failed} Aktionen sind fehlgeschlagen.`
}

/**
 * Whether the line is about something that is connected: the account it speaks of, or any account when
 * it speaks of all of them.
 */
export function isOnline(state: Pick<AppState, 'connected' | 'statusAccountId'>): boolean {
  const { connected, statusAccountId } = state
  return statusAccountId === null ? connected.length > 0 : connected.includes(statusAccountId)
}
