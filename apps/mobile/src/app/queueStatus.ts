import type { PendingSummary } from '@peregrine/core/pendingActions'
import { explainError } from '../errors'
import type { Services } from './services'
import type { AppState, AppStore } from './store'

/** Reads what waits in the queue into the store, for the account the status line speaks of. */
export async function refreshQueueStatus(services: Pick<Services, 'mail'>, store: AppStore): Promise<void> {
  const { statusAccountId } = store.state
  const summary = await services.mail.waiting()
  const reason = statusAccountId ? await services.mail.lastProblem(statusAccountId) : null
  const problem = reason === null ? null : explainError(reason)
  store.setWaiting({ summary, problem })
}

/** Gives up on what failed too often, which the user does after reading why it did, and reads what is left. */
export async function discardFailedActions(services: Pick<Services, 'mail'>, store: AppStore): Promise<void> {
  await services.mail.discardFailed()
  await refreshQueueStatus(services, store)
}

/**
 * The sentence about the actions that wait, or null when none does. A draft that waits to be kept is named, since it is
 * the one thing that is not decided yet and not on its way to somebody: when all that waits are drafts it says that,
 * and otherwise how many of the actions are.
 */
export function waitingText(summary: PendingSummary): string | null {
  // `total` is what waits: what was given up on is counted apart, in `failed`, and is not in it.
  const open = summary.total
  if (open <= 0) return null
  const drafts = Math.min(summary.byKind.saveDraft, open)
  if (drafts === open) return open === 1 ? '1 Entwurf wartet' : `${open} Entwürfe warten`
  const base = open === 1 ? '1 Aktion wartet' : `${open} Aktionen warten`
  if (drafts === 0) return base
  return drafts === 1 ? `${base}, davon 1 Entwurf` : `${base}, davon ${drafts} Entwürfe`
}

/** The sentence about the messages that wait for a moment that was chosen, or null when none does. */
export function scheduledText(summary: PendingSummary): string | null {
  if (summary.scheduled <= 0) return null
  return summary.scheduled === 1 ? '1 Nachricht ist zum Senden geplant' : `${summary.scheduled} Nachrichten sind zum Senden geplant`
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
