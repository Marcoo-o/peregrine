import { create } from 'zustand'
import type { SyncProgressEvent } from '@peregrine/core/types'

interface AccountProgress {
  current: number
  total: number
}

interface SyncState {
  /** True while a refresh is in flight. Either triggered by the user or by the scheduler. */
  running: boolean
  /** Progress of the current round per account; accounts sync in parallel. */
  progress: Record<string, AccountProgress>
  subscribe: () => () => void
  /** Runs "fetch all"; resolves once every account has finished. */
  syncAll: () => Promise<number>
}

export const useSyncStore = create<SyncState>((set, get) => ({
  running: false,
  progress: {},
  subscribe: () => {
    return window.peregrine.events.onSyncProgress((event: SyncProgressEvent) => {
      set((prev) => {
        const progress = { ...prev.progress }
        if (event.phase === 'done') {
          delete progress[event.accountId]
        } else {
          progress[event.accountId] = { current: event.current, total: event.total }
        }
        // A background round should light up the indicator too, so the user can tell why
        // the list is moving; it clears once the last account reports done.
        return { progress, running: prev.running || Object.keys(progress).length > 0 }
      })
      if (event.phase === 'done' && Object.keys(get().progress).length === 0) {
        set({ running: false })
      }
    })
  },
  syncAll: async () => {
    set({ running: true })
    try {
      const { syncedFolders } = await window.peregrine.sync.all()
      return syncedFolders
    } finally {
      set({ running: false, progress: {} })
    }
  }
}))

/** Folders done / folders total across all accounts, for a single progress readout. */
export function aggregateProgress(progress: Record<string, AccountProgress>): AccountProgress {
  return Object.values(progress).reduce(
    (sum, entry) => ({ current: sum.current + entry.current, total: sum.total + entry.total }),
    { current: 0, total: 0 }
  )
}
