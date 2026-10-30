import { describe, expect, it } from 'vitest'
import { isListScreen, isWide, paneAfter, paneWidths, WIDE_FROM } from './panes'
import type { MessageState, Screen } from './screens'
import { AppStore } from './store'

const list: Screen = { name: 'messages', account: undefined as never, folder: undefined as never, messages: [], showPreview: true, folderNames: {}, busy: false } as never
const unified: Screen = { name: 'unified', role: 'inbox', messages: [], showPreview: true, busy: false, problems: [], more: false } as never
const message = (uid: number): MessageState => ({ name: 'message', account: undefined as never, folder: undefined as never, summary: { uid } as never, origin: 'folder' })

describe('when there are two panes', () => {
  it('is from 600 points of width, a tablet or a folding phone opened', () => {
    expect(WIDE_FROM).toBe(600)
    expect(isWide(599)).toBe(false)
    expect(isWide(600)).toBe(true)
    expect(isWide(1280)).toBe(true)
  })

  it('has the list a share of the window that is neither too narrow for a row nor so wide that the message is cramped', () => {
    expect(paneWidths(600)).toEqual({ list: 320, detail: 280 })
    expect(paneWidths(1000).list).toBe(380)
    expect(paneWidths(2000)).toEqual({ list: 440, detail: 1560 })
    for (const width of [600, 840, 1200, 2400]) {
      const { list: left, detail } = paneWidths(width)
      expect(left + detail).toBe(width)
    }
  })

  it('says which screens are lists of messages', () => {
    for (const name of ['messages', 'unified', 'search', 'thread'] as const) expect(isListScreen({ name } as Screen)).toBe(true)
    for (const name of ['message', 'folders', 'settings', 'compose'] as const) expect(isListScreen({ name } as Screen)).toBe(false)
  })
})

describe('the list beside a message', () => {
  it('is the list the message was opened from', () => {
    expect(paneAfter({ screen: list, pane: null }, message(1))).toBe(list)
    expect(paneAfter({ screen: unified, pane: null }, message(1))).toBe(unified)
  })

  it('stays while another message is opened from it, and through what is done from a message and comes back to it', () => {
    const open = message(1)
    expect(paneAfter({ screen: open, pane: list }, message(2))).toBe(list)
    for (const name of ['compose', 'move', 'source'] as const) expect(paneAfter({ screen: open, pane: list }, { name } as Screen)).toBe(list)
  })

  it('is nothing for any other screen, which has the whole window, and for a message that was not opened from a list', () => {
    expect(paneAfter({ screen: message(1), pane: list }, list)).toBeNull()
    expect(paneAfter({ screen: message(1), pane: list }, { name: 'folders' } as Screen)).toBeNull()
    expect(paneAfter({ screen: message(1), pane: list }, { name: 'settings' } as Screen)).toBeNull()
    expect(paneAfter({ screen: { name: 'loading' }, pane: null }, message(1))).toBeNull()
  })
})

describe('the store and the list beside a message', () => {
  it('has none to begin with, the list when a message is opened from it, and none again when the message is left', () => {
    const store = new AppStore()
    expect(store.state.pane).toBeNull()
    store.showScreen(list)
    store.showScreen(message(1))
    expect(store.state.pane).toBe(list)
    store.showScreen(message(2))
    expect(store.state.pane).toBe(list)
    store.showScreen({ ...message(2), notice: 'Gespeichert' })
    expect(store.state.pane).toBe(list)
    store.showScreen(list)
    expect(store.state.pane).toBeNull()
  })

  it('keeps it through writing an answer, and has it when the message is shown again', () => {
    const store = new AppStore()
    store.showScreen(unified)
    const open = message(1)
    store.showScreen(open)
    store.showScreen({ name: 'compose' } as Screen)
    expect(store.state.pane).toBe(unified)
    store.showScreen(open)
    expect(store.state.pane).toBe(unified)
  })

  it('tells those who watch it, with the pane in the state that they read', () => {
    const store = new AppStore()
    const seen: Array<Screen | null> = []
    store.subscribe(() => seen.push(store.state.pane))
    store.showScreen(list)
    store.showScreen(message(1))
    expect(seen).toEqual([null, list])
  })
})
