import { errorText } from '@renderer/util/errorText'
import { create } from 'zustand'
import type { AccountSummary } from '@peregrine/core/types'

interface AccountsState {
  accounts: AccountSummary[]
  selectedAccountId: string | null
  loading: boolean
  error: string | null
  load: () => Promise<void>
  select: (accountId: string) => void
}

export const useAccountsStore = create<AccountsState>((set, get) => ({
  accounts: [],
  selectedAccountId: null,
  loading: false,
  error: null,
  load: async () => {
    set({ loading: true, error: null })
    try {
      const accounts = await window.peregrine.accounts.list()
      set({
        accounts,
        loading: false,
        selectedAccountId: get().selectedAccountId ?? accounts[0]?.id ?? null
      })
    } catch (err) {
      const message = errorText(err)
      console.error('accounts.list failed:', message)
      set({ loading: false, error: message })
    }
  },
  select: (accountId: string) => set({ selectedAccountId: accountId })
}))
