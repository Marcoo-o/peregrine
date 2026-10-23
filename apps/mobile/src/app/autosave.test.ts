import { describe, expect, it } from 'vitest'
import { emptyDraft } from '../draft'
import { autosaveDue } from './autosave'

const started = { ...emptyDraft }
const state = (over: Partial<Parameters<typeof autosaveDue>[0]> = {}) => ({ busy: false, draft: started, ...over })

describe('when a message is kept by itself', () => {
  it('is not when nothing has been written', () => {
    expect(autosaveDue(state(), started)).toBe(false)
  })

  it('is once something has been written that was not there when it began', () => {
    expect(autosaveDue(state(), { ...started, body: 'Hello' })).toBe(true)
  })

  it('is not when it is as it was when it was last kept, and is again after a change since', () => {
    const kept = { ...started, body: 'Hello' }
    expect(autosaveDue(state({ savedDraft: kept }), { ...kept })).toBe(false)
    expect(autosaveDue(state({ savedDraft: kept }), { ...kept, body: 'Hello again' })).toBe(true)
  })

  it('compares with what was kept and not with how it began once something was kept', () => {
    const kept = { ...started, body: 'Hello' }
    // Back to what it began as is a change from what is kept, which is what the server has.
    expect(autosaveDue(state({ savedDraft: kept }), started)).toBe(true)
  })

  it('is not while the message is being sent or kept by hand', () => {
    expect(autosaveDue(state({ busy: true }), { ...started, body: 'Hello' })).toBe(false)
  })

  it('is not after the server did not say where it put a draft, which a later one could not replace', () => {
    expect(autosaveDue(state({ noAutosave: true }), { ...started, body: 'Hello' })).toBe(false)
  })
})
