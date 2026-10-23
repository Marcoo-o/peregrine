import { isChanged, type Draft } from '../draft'
import type { ComposeState } from './screens'

/**
 * Whether the message is to be kept as a draft by itself now: not while it is being sent or kept by hand, not after the
 * server has not said where a draft is (a later revision could not replace it, and there would be two), and not when it
 * is as it was when it was last kept or, if it was not, as it was when it began.
 */
export function autosaveDue(state: Pick<ComposeState, 'busy' | 'noAutosave' | 'savedDraft' | 'draft'>, draft: Draft): boolean {
  if (state.busy || state.noAutosave) return false
  return isChanged(state.savedDraft ?? state.draft, draft)
}
