/**
 * The keyboard shortcuts of the mailbox, and how they are stored.
 *
 * A shortcut is written as a single string ("r", "Shift+R", "Ctrl+K") because that is also
 * how it is displayed. Parsing it back is cheap, and one string per action keeps the stored
 * settings readable enough to fix by hand if it ever comes to that.
 */

export type ShortcutAction =
  | 'nextMessage'
  | 'previousMessage'
  | 'reply'
  | 'replyAll'
  | 'forward'
  | 'archive'
  | 'junk'
  | 'delete'
  | 'markUnread'
  | 'search'

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  'nextMessage',
  'previousMessage',
  'reply',
  'replyAll',
  'forward',
  'archive',
  'junk',
  'delete',
  'markUnread',
  'search'
]

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string> = {
  nextMessage: 'ArrowDown',
  previousMessage: 'ArrowUp',
  reply: 'r',
  replyAll: 'R',
  forward: 'f',
  archive: 'e',
  junk: 'j',
  delete: 'Delete',
  markUnread: 'u',
  search: 'Ctrl+K'
}

export interface ParsedShortcut {
  key: string
  ctrl: boolean
  shift: boolean
  alt: boolean
}

export function parseShortcut(value: string): ParsedShortcut | null {
  const parts = value.split('+').map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return null

  const key = parts[parts.length - 1]
  if (!key) return null
  const modifiers = parts.slice(0, -1).map((m) => m.toLowerCase())

  return {
    key,
    ctrl: modifiers.includes('ctrl') || modifiers.includes('cmd'),
    shift: modifiers.includes('shift'),
    alt: modifiers.includes('alt')
  }
}

/**
 * Describes a key event the same way a stored shortcut is written.
 *
 * Shift is folded into the key for printable characters. The event for Shift+r already
 * reports "R", and recording it as both a shifted modifier and an uppercase key would never
 * match anything.
 */
export function shortcutFromEvent(event: {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}): string {
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  // For a letter the case already carries the shift; for named keys it does not.
  if (event.shiftKey && event.key.length > 1) parts.push('Shift')
  parts.push(event.key)
  return parts.join('+')
}

/** Whether a key event triggers a stored shortcut. */
export function matchesShortcut(stored: string, event: {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}): boolean {
  const shortcut = parseShortcut(stored)
  if (!shortcut) return false

  // Letters are compared case-sensitively, so "R" means Shift+r and "r" does not.
  const keyMatches =
    shortcut.key.length === 1 ? shortcut.key === event.key : shortcut.key.toLowerCase() === event.key.toLowerCase()

  return (
    keyMatches &&
    shortcut.ctrl === (event.ctrlKey || event.metaKey) &&
    shortcut.alt === event.altKey &&
    // Named keys carry Shift as a modifier; for a letter it is already in the key itself.
    (shortcut.key.length === 1 || shortcut.shift === event.shiftKey)
  )
}

/** Keys that cannot be a shortcut on their own, because typing would become impossible. */
const FORBIDDEN_ALONE = new Set(['Tab', 'Escape', 'Enter', ' ', 'Shift', 'Control', 'Alt', 'Meta'])

export function isAssignable(value: string): boolean {
  const shortcut = parseShortcut(value)
  if (!shortcut) return false
  if (!shortcut.ctrl && !shortcut.alt && FORBIDDEN_ALONE.has(shortcut.key)) return false
  return !['Shift', 'Control', 'Alt', 'Meta'].includes(shortcut.key)
}

export function parseShortcuts(raw: string): Record<ShortcutAction, string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ...DEFAULT_SHORTCUTS }
  }
  if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_SHORTCUTS }

  const shortcuts = { ...DEFAULT_SHORTCUTS }
  for (const [action, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!SHORTCUT_ACTIONS.includes(action as ShortcutAction)) continue
    // An empty string is a deliberately unassigned action, so it is kept as such.
    if (typeof value !== 'string') continue
    if (value !== '' && !isAssignable(value)) continue
    shortcuts[action as ShortcutAction] = value
  }
  return shortcuts
}

/** Actions sharing a shortcut. The second one would never fire, so it is worth reporting. */
export function conflictsIn(shortcuts: Record<ShortcutAction, string>): ShortcutAction[] {
  const seen = new Map<string, ShortcutAction>()
  const conflicting = new Set<ShortcutAction>()

  for (const action of SHORTCUT_ACTIONS) {
    const value = shortcuts[action]
    if (!value) continue
    const existing = seen.get(value)
    if (existing) {
      conflicting.add(existing)
      conflicting.add(action)
    } else {
      seen.set(value, action)
    }
  }
  return [...conflicting]
}
