import { useEffect, useRef } from 'react'
import type { ComposeState } from '../app/screens'
import { autosaveDue } from '../app/autosave'
import type { Draft } from '../draft'

/** How long writing has to pause before the message is kept by itself, which is what the desktop waits too. */
export const AUTOSAVE_PAUSE_MS = 4000

/**
 * Keeps the message as a draft once writing has paused: every change starts the wait again, so it is kept when the
 * writing stops and not at every letter. Nothing is kept while the message is being sent or kept by hand, or after the
 * server has not said where a draft is, and nothing for a message that is as it was when it was last kept.
 */
export function useAutosave(state: ComposeState, draft: Draft, keep: (draft: Draft) => void): void {
  const latest = useRef(keep)
  latest.current = keep
  const due = autosaveDue(state, draft)
  useEffect(() => {
    if (!due) return undefined
    const timer = setTimeout(() => latest.current(draft), AUTOSAVE_PAUSE_MS)
    return () => clearTimeout(timer)
  }, [due, draft])
}
