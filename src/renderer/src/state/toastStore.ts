import { create } from 'zustand'
import { errorText } from '@renderer/util/errorText'

export type ToastKind = 'info' | 'success' | 'error'

export interface ToastAction {
  label: string
  run: () => void | Promise<void>
}

export interface Toast {
  id: number
  kind: ToastKind
  message: string
  action?: ToastAction
}

interface ToastState {
  toasts: Toast[]
  show: (toast: Omit<Toast, 'id'>, timeoutMs?: number) => number
  dismiss: (id: number) => void
}

const DEFAULT_TIMEOUT_MS = 6000
let nextId = 1

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  show: (toast, timeoutMs = DEFAULT_TIMEOUT_MS) => {
    const id = nextId++
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }))
    // Errors stay until dismissed. They usually need reading, and often acting on.
    if (toast.kind !== 'error') setTimeout(() => get().dismiss(id), timeoutMs)
    return id
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
}))

/**
 * `fallback` says what was being attempted, the error says why it failed.
 *
 * The raw message used to go straight into the toast, IPC wrapper and all: "Move failed: Error
 * invoking remote method 'messages:move': Error: notConnected". The console still gets the
 * untouched text. That is where one goes looking for the cause.
 */
export function toastError(error: unknown, fallback: string): void {
  console.error(fallback, error)
  useToastStore.getState().show({ kind: 'error', message: `${fallback}: ${errorText(error)}` })
}

export function toastInfo(message: string, action?: ToastAction): void {
  useToastStore.getState().show({ kind: 'info', message, action })
}
