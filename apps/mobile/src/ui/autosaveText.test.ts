import { describe, expect, it } from 'vitest'
import { autosaveText } from './autosaveText'

describe('what the compose screen says about the draft kept by itself', () => {
  it('says that it is being kept', () => {
    expect(autosaveText({ status: 'saving' })).toBe('Entwurf wird gespeichert …')
  })

  it('says that it waits for a connection', () => {
    expect(autosaveText({ status: 'waiting' })).toBe('Entwurf wartet auf eine Verbindung')
  })

  it('says when it was kept, to the minute', () => {
    const at = new Date(2026, 9, 23, 14, 3, 30).getTime()
    expect(autosaveText({ status: 'saved', at })).toBe('Entwurf gespeichert um 14:03')
  })

  it('says that it could not be, and why', () => {
    expect(autosaveText({ status: 'failed', error: 'Der Server ist nicht erreichbar.' })).toBe(
      'Entwurf konnte nicht gespeichert werden: Der Server ist nicht erreichbar.'
    )
  })
})
