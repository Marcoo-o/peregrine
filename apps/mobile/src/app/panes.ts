import type { Screen } from './screens'

/** From how wide on the list and the open message are shown side by side, in the points the platform measures a screen in: a tablet, a folding phone opened, a phone on its side. */
export const WIDE_FROM = 600

/** Whether a screen is wide enough for two panes. */
export const isWide = (width: number): boolean => width >= WIDE_FROM

/** The screens that are a list of messages: what is on the left while a message is open on the right. */
const LISTS: readonly Screen['name'][] = ['messages', 'unified', 'search', 'thread']

export const isListScreen = (screen: Screen): boolean => LISTS.includes(screen.name)

/**
 * The screens that go on while a message is open: the message itself, and what is done from it and comes back to it (writing an answer, choosing a folder to move
 * it to, looking at its source). The list stays remembered through them, so the message is beside it again when they are done.
 */
const KEEPS: readonly Screen['name'][] = ['message', 'compose', 'move', 'source']

/**
 * What the left pane is after a screen is shown: the list that was shown when a message is opened from it; what it was while the message, or what is done from it, goes
 * on; and nothing for any other screen, which has the whole of the window.
 */
export function paneAfter(current: { screen: Screen; pane: Screen | null }, next: Screen): Screen | null {
  if (next.name === 'message' && isListScreen(current.screen)) return current.screen
  return KEEPS.includes(next.name) ? current.pane : null
}

/** The widths of the two panes: the list a share of the window that is not too narrow for a row nor so wide that the message is cramped, and the message the rest. */
export function paneWidths(width: number): { list: number; detail: number } {
  const list = Math.round(Math.min(Math.max(width * 0.38, 320), 440))
  return { list, detail: width - list }
}
