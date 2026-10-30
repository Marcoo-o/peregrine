import { describe, expect, it } from 'vitest'
import { emptySummary } from '@peregrine/core/pendingActions'
import { showsQueueStatus, type Screen } from './screens'
import { AppStore } from './store'

describe('the store', () => {
  it('starts on the loading screen, with nothing connected and nothing waiting', () => {
    expect(new AppStore().state).toEqual({
      screen: { name: 'loading' },
      connected: [],
      waiting: null,
      statusAccountId: null,
      tags: [],
      undo: null,
      sort: { field: 'date', direction: 'desc' },
      safety: { warnSuspiciousLinks: true, confirmAllLinks: false, warnRiskyAttachments: true },
      conversations: true,
      locked: false
    })
  })

  it('changes one thing at a time and keeps the rest', () => {
    const store = new AppStore()
    store.showScreen({ name: 'login' })
    store.setConnected(['a'])
    store.setStatusAccount('a')
    store.setWaiting({ summary: emptySummary(), problem: null })
    expect(store.state).toMatchObject({ screen: { name: 'login' }, connected: ['a'], statusAccountId: 'a' })
    expect(store.state.waiting?.problem).toBeNull()
  })

  it('holds the tags that were made', () => {
    const store = new AppStore()
    const tag = { id: 't', name: 'Work', keyword: 'Work', color: '#2f5d9f', sortOrder: 0 }
    store.setTags([tag])
    expect(store.state.tags).toEqual([tag])
  })

  it('replaces the state and does not change it, so that a screen can tell that it changed', () => {
    const store = new AppStore()
    const before = store.state
    store.setConnected(['a'])
    expect(store.state).not.toBe(before)
    expect(before.connected).toEqual([])
  })

  it('tells every listener after every change, until it stops listening', () => {
    const store = new AppStore()
    const calls: string[] = []
    const stopFirst = store.subscribe(() => calls.push('first'))
    store.subscribe(() => calls.push('second'))
    store.setConnected(['a'])
    stopFirst()
    store.setConnected([])
    expect(calls).toEqual(['first', 'second', 'second'])
  })

  it('has the screen it was told to show', () => {
    const store = new AppStore()
    const screen: Screen = { name: 'accounts', accounts: [] }
    store.showScreen(screen)
    expect(store.screen).toBe(screen)
  })
})

describe('which screens show the queue', () => {
  it('are those about the mail of the accounts', () => {
    const shown = (name: Screen['name']) => showsQueueStatus({ name } as Screen)
    for (const name of ['unified', 'folders', 'messages', 'message', 'move'] as const) expect(shown(name)).toBe(true)
    for (const name of ['loading', 'accounts', 'login', 'compose'] as const) expect(shown(name)).toBe(false)
  })
})
