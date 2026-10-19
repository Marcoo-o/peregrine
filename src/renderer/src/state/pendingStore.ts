import { create } from 'zustand'
import { emptySummary, type PendingSummary } from '@peregrine/core/pendingActions'

interface PendingState {
  summary: PendingSummary
  load: () => Promise<void>
  set: (summary: PendingSummary) => void
  discardFailed: () => Promise<void>
}

/**
 * What is still waiting for a connection.
 *
 * Read once on start and kept current by an event afterwards. The main process is the only
 * one that changes this, and it says so whenever it does.
 */
export const usePendingStore = create<PendingState>((set) => ({
  summary: emptySummary(),

  load: async () => {
    try {
      set({ summary: await window.peregrine.messages.pendingGet() })
    } catch (err) {
      console.error('reading the waiting actions failed:', err)
    }
  },

  set: (summary) => set({ summary }),

  discardFailed: async () => {
    set({ summary: await window.peregrine.messages.pendingDiscardFailed() })
  }
}))
