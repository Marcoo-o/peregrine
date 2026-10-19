import { create } from 'zustand'
import type { ConnectionState } from '@peregrine/core/types'

interface ConnectionStoreState {
  states: Record<string, ConnectionState>
  setState: (accountId: string, state: ConnectionState) => void
  subscribe: () => () => void
}

export const useConnectionStore = create<ConnectionStoreState>((set) => ({
  states: {},
  setState: (accountId, state) =>
    set((prev) => ({ states: { ...prev.states, [accountId]: state } })),
  subscribe: () => {
    return window.peregrine.events.onAccountConnectionState(({ accountId, state }) => {
      set((prev) => ({ states: { ...prev.states, [accountId]: state } }))
    })
  }
}))
