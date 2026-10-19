/**
 * Which dialog is currently on top.
 *
 * Two questions hang on that, and both concern only the topmost one. Who receives the Escape
 * key, and which panel Tab has to stay inside. Without a stack every open dialog hears the
 * same keystroke. A prompt opened on top of another dialog would close both at once, and Tab
 * would jump back and forth between two panels.
 *
 * A module of its own with no DOM dependency, so the ordering logic can be tested. It goes
 * wrong in exactly the case that is hardest to reach by hand.
 */
export interface DialogEntry {
  onEscape: () => void
  /** The panel itself, the boundary for Tab. Null until it has been rendered. */
  panel: () => HTMLElement | null
}

const stack: DialogEntry[] = []

/** Registers a dialog on top and hands back the way to remove it again. */
export function pushDialog(entry: DialogEntry): () => void {
  stack.push(entry)
  let removed = false
  return () => {
    // Guarded, because React may run a cleanup twice under strict mode. A second removal would
    // otherwise take another dialog's entry off the stack.
    if (removed) return
    removed = true
    const index = stack.lastIndexOf(entry)
    if (index !== -1) stack.splice(index, 1)
  }
}

export function topDialog(): DialogEntry | null {
  return stack[stack.length - 1] ?? null
}

/** True when someone took the key, in which case the caller stops it travelling further. */
export function dispatchEscape(): boolean {
  const top = topDialog()
  if (!top) return false
  top.onEscape()
  return true
}

export function openDialogCount(): number {
  return stack.length
}

/**
 * What Tab can reach inside a panel.
 *
 * `offsetParent` rules out anything hidden. A field behind a collapsed section is in the tree
 * but not on screen, and the focus must not land there. `<details>` and `position: fixed` fail
 * this check, and neither occurs in these dialogs.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ')

export function focusables(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement
  )
}
