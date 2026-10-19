import { describe, expect, it } from 'vitest'
import {
  conflictsIn,
  DEFAULT_SHORTCUTS,
  isAssignable,
  matchesShortcut,
  parseShortcuts,
  shortcutFromEvent
} from './shortcuts'

const event = (key: string, mods: Partial<{ ctrl: boolean; shift: boolean; alt: boolean }> = {}) => ({
  key,
  ctrlKey: mods.ctrl ?? false,
  metaKey: false,
  shiftKey: mods.shift ?? false,
  altKey: mods.alt ?? false
})

describe('shortcutFromEvent', () => {
  it('describes a plain letter', () => {
    expect(shortcutFromEvent(event('r'))).toBe('r')
  })

  // The event for Shift+r already reports "R"; recording it as "Shift+R" as well would
  // produce something no event can ever match.
  it('leaves the shift in the letter rather than adding a modifier', () => {
    expect(shortcutFromEvent(event('R', { shift: true }))).toBe('R')
  })

  it('names Shift for keys that have no case', () => {
    expect(shortcutFromEvent(event('ArrowDown', { shift: true }))).toBe('Shift+ArrowDown')
  })

  it('describes combinations', () => {
    expect(shortcutFromEvent(event('k', { ctrl: true }))).toBe('Ctrl+k')
    expect(shortcutFromEvent(event('x', { ctrl: true, alt: true }))).toBe('Ctrl+Alt+x')
  })

  it('treats Cmd like Ctrl', () => {
    expect(shortcutFromEvent({ ...event('k'), metaKey: true })).toBe('Ctrl+k')
  })
})

describe('matchesShortcut', () => {
  it('matches a plain letter', () => {
    expect(matchesShortcut('r', event('r'))).toBe(true)
  })

  it('tells upper and lower case apart', () => {
    expect(matchesShortcut('R', event('r'))).toBe(false)
    expect(matchesShortcut('R', event('R', { shift: true }))).toBe(true)
  })

  it('requires the modifier to match', () => {
    expect(matchesShortcut('r', event('r', { ctrl: true }))).toBe(false)
    expect(matchesShortcut('Ctrl+k', event('k'))).toBe(false)
    expect(matchesShortcut('Ctrl+k', event('k', { ctrl: true }))).toBe(true)
  })

  it('matches named keys regardless of case', () => {
    expect(matchesShortcut('ArrowDown', event('ArrowDown'))).toBe(true)
    expect(matchesShortcut('delete', event('Delete'))).toBe(true)
  })

  it('never matches an unassigned action', () => {
    expect(matchesShortcut('', event('r'))).toBe(false)
  })
})

describe('isAssignable', () => {
  it('accepts ordinary keys', () => {
    expect(isAssignable('r')).toBe(true)
    expect(isAssignable('Ctrl+k')).toBe(true)
    expect(isAssignable('Delete')).toBe(true)
  })

  // Binding these on their own would make the interface unusable.
  it('refuses keys that navigation depends on', () => {
    expect(isAssignable('Tab')).toBe(false)
    expect(isAssignable('Escape')).toBe(false)
    expect(isAssignable('Enter')).toBe(false)
  })

  it('allows those keys with a modifier', () => {
    expect(isAssignable('Ctrl+Enter')).toBe(true)
  })

  it('refuses a bare modifier', () => {
    expect(isAssignable('Shift')).toBe(false)
    expect(isAssignable('Control')).toBe(false)
  })
})

describe('parseShortcuts', () => {
  it('falls back to the defaults for unreadable input', () => {
    expect(parseShortcuts('kaputt')).toEqual(DEFAULT_SHORTCUTS)
  })

  it('overrides only what is stored', () => {
    expect(parseShortcuts('{"reply":"a"}')).toEqual({ ...DEFAULT_SHORTCUTS, reply: 'a' })
  })

  it('ignores unknown actions and unassignable keys', () => {
    expect(parseShortcuts('{"erfunden":"a","reply":"Tab"}')).toEqual(DEFAULT_SHORTCUTS)
  })

  it('keeps an empty string as a deliberately unassigned action', () => {
    expect(parseShortcuts('{"junk":""}').junk).toBe('')
  })
})

describe('conflictsIn', () => {
  it('says nothing about the defaults', () => {
    expect(conflictsIn(DEFAULT_SHORTCUTS)).toEqual([])
  })

  it('reports both actions sharing a key', () => {
    const conflicts = conflictsIn({ ...DEFAULT_SHORTCUTS, junk: 'r' })
    expect(conflicts).toContain('reply')
    expect(conflicts).toContain('junk')
  })

  it('does not treat several unassigned actions as a conflict', () => {
    expect(conflictsIn({ ...DEFAULT_SHORTCUTS, junk: '', archive: '' })).toEqual([])
  })
})
