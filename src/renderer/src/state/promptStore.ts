import { create } from 'zustand'

export interface PromptOptions {
  title: string
  /** Prefilled value; the field opens with it selected so typing replaces it. */
  defaultValue?: string
  placeholder?: string
  /** For values that are pasted rather than typed. A PGP key, for instance. */
  multiline?: boolean
  /** Masks the field. For passphrases, which are read over shoulders like any other password. */
  secret?: boolean
  confirmLabel?: string
}

export interface PromptRequest extends PromptOptions {
  id: number
  resolve: (value: string | null) => void
}

interface PromptState {
  request: PromptRequest | null
  answer: (value: string | null) => void
}

let nextId = 1

export const usePromptStore = create<PromptState>((set, get) => ({
  request: null,
  answer: (value) => {
    const request = get().request
    if (!request) return
    set({ request: null })
    request.resolve(value)
  }
}))

/**
 * Asks the user for a line of text.
 *
 * This exists because Electron does not implement `window.prompt`. It throws outright, so
 * every place that asked for a folder name silently did nothing. Resolves to null when the
 * dialog is dismissed, which is the same contract the browser function had, so call sites
 * keep reading the way they did.
 */
export function askForText(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const previous = usePromptStore.getState().request
    // Two dialogs cannot be on screen at once; the one already waiting is answered as
    // cancelled rather than left hanging on a promise that will never settle.
    previous?.resolve(null)
    usePromptStore.setState({ request: { ...options, id: nextId++, resolve } })
  })
}
