import { useEffect, useRef, type RefObject } from 'react'
import {
  dispatchEscape,
  focusables,
  openDialogCount,
  pushDialog,
  topDialog
} from './dialogStack'

/**
 * Everything a modal window owes the keyboard. Escape closes it, Tab stays inside it, and
 * afterwards the focus returns to wherever it came from.
 *
 * **Escape** used to exist in five different implementations, and in two dialogs not at all.
 * Two listened on a field, which only works while the caret is in that field. Two listened on
 * the backdrop, which only works once something inside has focus. One listened on the window.
 * Escape either closes a dialog or it does not, and you find out by pressing it.
 *
 * **Tab** used to walk straight out of every dialog. Measured on the Thunderbird import: on
 * open the focus sat on `body`, and the first sixteen Tab steps went through the settings
 * navigation *behind* the window, controls under an overlay you cannot see through. Only the
 * seventeenth reached the dialog.
 *
 * **The way back** was missing as well. After closing, the focus landed on `body` and the next
 * Tab started from the beginning again rather than at the button that had opened the dialog.
 *
 * Both listen on the window in the capture phase, so neither depends on where the focus
 * happens to be, and the key arrives before anything behind the dialog sees it.
 */
function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    if (!dispatchEscape()) return
    // Closing a dialog only takes the surface away. The same press would otherwise carry on
    // into the view behind it and clear a selection there or leave a field.
    event.preventDefault()
    event.stopPropagation()
    return
  }

  if (event.key !== 'Tab') return
  const panel = topDialog()?.panel() ?? null
  if (!panel) return

  const stops = focusables(panel)
  if (stops.length === 0) {
    event.preventDefault()
    return
  }
  const first = stops[0]
  const last = stops[stops.length - 1]
  const current = document.activeElement

  const target = !panel.contains(current)
    ? event.shiftKey
      ? last
      : first
    : !event.shiftKey && current === last
      ? first
      : event.shiftKey && current === first
        ? last
        : null

  if (target) {
    event.preventDefault()
    target.focus()
  }
}

/**
 * @param onClose what Escape should do
 * @param enabled false while closing would be wrong, during an import that is already running
 *   for instance. The dialog keeps its place on the stack and swallows the key, so Escape does
 *   not fall through to whatever lies behind it either.
 * @returns the ref for the panel itself. Without it there is no boundary for Tab, because the
 *   hook cannot guess which of the `div`s is the dialog.
 */
export function useDialog(onClose: () => void, enabled = true): RefObject<HTMLDivElement | null> {
  const panelRef = useRef<HTMLDivElement>(null)

  /**
   * The current callback, read at the moment the key is pressed.
   *
   * Registration happens once, on mount, and that is the point. Callers pass an inline arrow,
   * which is a new function on every render. Listing it as a dependency would pop and re-push
   * this dialog constantly, and re-pushing puts it back on *top*, so a dialog underneath
   * another one would start swallowing that one's Escape.
   */
  const latest = useRef({ onClose, enabled })
  latest.current = { onClose, enabled }

  useEffect(() => {
    const opener = document.activeElement
    const remove = pushDialog({
      onEscape: () => {
        if (latest.current.enabled) latest.current.onClose()
      },
      panel: () => panelRef.current
    })
    if (openDialogCount() === 1) window.addEventListener('keydown', onKeyDown, true)

    // Only when nothing inside the dialog holds the focus already. Several windows set it
    // themselves, the command palette with `autoFocus` on its search field and the reminder
    // dialog on its first preset. Taking that away again would be a step backwards.
    const panel = panelRef.current
    if (panel && !panel.contains(document.activeElement)) {
      const [first] = focusables(panel)
      first?.focus()
    }

    return () => {
      remove()
      if (openDialogCount() === 0) window.removeEventListener('keydown', onKeyDown, true)
      // Back to whatever opened this, if it is still there. A dialog opened from a list may
      // have removed that row by the time it closes.
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])

  return panelRef
}
