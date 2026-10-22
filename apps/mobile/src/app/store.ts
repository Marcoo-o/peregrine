import type { PendingSummary } from '@peregrine/core/pendingActions'
import type { Tag } from '../tags'
import type { Screen } from './screens'

/** What waits in the queue, and why the first action that failed did. */
export interface QueueStatus {
  summary: PendingSummary
  problem: string | null
}

export interface AppState {
  screen: Screen
  /** The accounts that have a connection now. */
  connected: string[]
  waiting: QueueStatus | null
  /** The account the status line speaks of, or null when it speaks of all of them. */
  statusAccountId: string | null
  /** The tags the user has made, which every list shows on its messages. */
  tags: Tag[]
}

type Listener = () => void

/**
 * Everything the screens show, in one place that is not React's.
 *
 * The logic of the application changes it and the screens read it, so the logic can be written and
 * tested without a screen, and a screen is a function of the state. The state is replaced and not
 * changed in place, which is what lets a screen tell that it changed.
 */
export class AppStore {
  private current: AppState = { screen: { name: 'loading' }, connected: [], waiting: null, statusAccountId: null, tags: [] }
  private readonly listeners = new Set<Listener>()

  get state(): AppState {
    return this.current
  }

  get screen(): Screen {
    return this.current.screen
  }

  showScreen(screen: Screen): void {
    this.update({ screen })
  }

  setConnected(connected: string[]): void {
    this.update({ connected })
  }

  setWaiting(waiting: QueueStatus | null): void {
    this.update({ waiting })
  }

  setStatusAccount(statusAccountId: string | null): void {
    this.update({ statusAccountId })
  }

  setTags(tags: Tag[]): void {
    this.update({ tags })
  }

  /** Calls the listener after every change, and returns the way to stop. */
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private update(patch: Partial<AppState>): void {
    this.current = { ...this.current, ...patch }
    this.listeners.forEach((listener) => listener())
  }
}
