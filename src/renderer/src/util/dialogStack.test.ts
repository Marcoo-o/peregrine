import { afterEach, describe, expect, it, vi } from 'vitest'
import { dispatchEscape, openDialogCount, pushDialog, topDialog } from './dialogStack'

const cleanups: Array<() => void> = []

function open(handler: () => void): () => void {
  const remove = pushDialog({ onEscape: handler, panel: () => null })
  cleanups.push(remove)
  return remove
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

describe('dialogStack', () => {
  it('closes the one on top', () => {
    const below = vi.fn()
    const above = vi.fn()
    open(below)
    open(above)

    expect(dispatchEscape()).toBe(true)
    expect(above).toHaveBeenCalledOnce()
    expect(below).not.toHaveBeenCalled()
  })

  // The whole reason for a stack. Both dialogs listen on the same window, so without it one
  // press would reach both and close a prompt together with the dialog that opened it.
  it('never closes two at once', () => {
    const outer = vi.fn()
    const inner = vi.fn()
    open(outer)
    const closeInner = open(inner)

    dispatchEscape()
    closeInner()
    dispatchEscape()

    expect(inner).toHaveBeenCalledOnce()
    expect(outer).toHaveBeenCalledOnce()
  })

  it('hands the key back to the one underneath once the top one is gone', () => {
    const below = vi.fn()
    open(below)
    const closeAbove = open(vi.fn())

    closeAbove()
    dispatchEscape()
    expect(below).toHaveBeenCalledOnce()
  })

  // Otherwise the key would be swallowed with nothing to act on it, and a view that handles
  // Escape for itself, the context menu or a search field, would stop responding.
  it('reports that nobody took the key when nothing is open', () => {
    expect(dispatchEscape()).toBe(false)
  })

  it('removes the right one when the middle dialog closes first', () => {
    const first = vi.fn()
    const third = vi.fn()
    open(first)
    const closeSecond = open(vi.fn())
    open(third)

    closeSecond()
    dispatchEscape()
    expect(third).toHaveBeenCalledOnce()
    expect(openDialogCount()).toBe(2)
  })

  // React can run a cleanup twice; a second removal that took the top entry off would leave
  // the dialog above this one unreachable by Escape.
  it('a cleanup run twice does not take someone else off the stack', () => {
    const other = vi.fn()
    const closeOne = open(vi.fn())
    open(other)

    closeOne()
    closeOne()

    expect(openDialogCount()).toBe(1)
    dispatchEscape()
    expect(other).toHaveBeenCalledOnce()
  })
})

/**
 * The same stack answers the second question, which panel Tab has to stay inside. That one
 * also concerns the topmost dialog only. Otherwise the focus would jump back and forth between
 * two dialogs, one of which lies under an overlay you cannot see through.
 */
describe('topDialog', () => {
  it('is nothing while no dialog is open', () => {
    expect(topDialog()).toBeNull()
  })

  it('names the panel of the topmost dialog, not of the one below', () => {
    const below = {} as HTMLElement
    const above = {} as HTMLElement
    cleanups.push(pushDialog({ onEscape: () => {}, panel: () => below }))
    const close = pushDialog({ onEscape: () => {}, panel: () => above })
    cleanups.push(close)

    expect(topDialog()?.panel()).toBe(above)
    close()
    expect(topDialog()?.panel()).toBe(below)
  })

  // The hook registers before React puts the panel into the tree. Between registration and
  // the first render the element does not exist yet, and a keystroke in that moment must not
  // fail because of it.
  it('copes with a panel that is not rendered yet', () => {
    cleanups.push(pushDialog({ onEscape: () => {}, panel: () => null }))
    expect(topDialog()?.panel()).toBeNull()
  })
})
