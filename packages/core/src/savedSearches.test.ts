import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SAVED_SEARCH_COLOR,
  parseSavedSearches,
  removeSavedSearch,
  serializeSavedSearches,
  suggestSavedSearchName,
  toggleAccountScope,
  upsertSavedSearch,
  type SavedSearch
} from './savedSearches'

function search(patch: Partial<SavedSearch> = {}): SavedSearch {
  return {
    id: 'a',
    name: 'Rechnungen',
    query: 'betreff:Rechnung',
    color: DEFAULT_SAVED_SEARCH_COLOR,
    accountIds: [],
    includeTrash: false,
    ...patch
  }
}

describe('parseSavedSearches', () => {
  it('reads a stored list', () => {
    const raw = serializeSavedSearches([search()])
    expect(parseSavedSearches(raw)).toEqual([search()])
  })

  it('treats unreadable input as no saved searches', () => {
    expect(parseSavedSearches('kaputt')).toEqual([])
    expect(parseSavedSearches('{"a":1}')).toEqual([])
    expect(parseSavedSearches(undefined)).toEqual([])
  })

  // One damaged entry must not cost the whole list. They all share a single stored value.
  it('keeps the intact entries when one is damaged', () => {
    const raw = JSON.stringify([{ id: 'a' }, search({ id: 'b' })])
    expect(parseSavedSearches(raw).map((entry) => entry.id)).toEqual(['b'])
  })

  it('drops entries without a name or a query, which could not be clicked or removed', () => {
    const raw = JSON.stringify([
      search({ id: 'a', name: '  ' }),
      search({ id: 'b', query: '' }),
      search({ id: 'c' })
    ])
    expect(parseSavedSearches(raw).map((entry) => entry.id)).toEqual(['c'])
  })

  it('drops duplicate ids, which would collide as the selected view', () => {
    const raw = JSON.stringify([search({ id: 'a', name: 'Erste' }), search({ id: 'a', name: 'Zweite' })])
    expect(parseSavedSearches(raw).map((entry) => entry.name)).toEqual(['Erste'])
  })

  // The colour ends up in a style attribute, so anything that is not a plain hex value is
  // replaced rather than passed through.
  it('replaces a colour that is not #rrggbb', () => {
    const raw = JSON.stringify([search({ color: 'red; background: url(http://x)' })])
    expect(parseSavedSearches(raw)[0].color).toBe(DEFAULT_SAVED_SEARCH_COLOR)
  })

  it('keeps only string account ids', () => {
    const raw = JSON.stringify([search({ accountIds: ['acc-1', 7, null] as unknown as string[] })])
    expect(parseSavedSearches(raw)[0].accountIds).toEqual(['acc-1'])
  })

  it('defaults includeTrash to off', () => {
    const raw = JSON.stringify([{ id: 'a', name: 'N', query: 'q' }])
    expect(parseSavedSearches(raw)[0].includeTrash).toBe(false)
  })
})

describe('upsertSavedSearch', () => {
  it('appends a new entry', () => {
    expect(upsertSavedSearch([search()], search({ id: 'b' })).map((e) => e.id)).toEqual(['a', 'b'])
  })

  // Editing must not send the entry to the end of the sidebar.
  it('replaces in place', () => {
    const list = [search({ id: 'a' }), search({ id: 'b' }), search({ id: 'c' })]
    const next = upsertSavedSearch(list, search({ id: 'b', name: 'Neu' }))
    expect(next.map((e) => e.id)).toEqual(['a', 'b', 'c'])
    expect(next[1].name).toBe('Neu')
  })
})

describe('removeSavedSearch', () => {
  it('removes by id', () => {
    expect(removeSavedSearch([search({ id: 'a' }), search({ id: 'b' })], 'a').map((e) => e.id)).toEqual(['b'])
  })
})

describe('toggleAccountScope', () => {
  const all = ['a', 'b', 'c']

  // Empty means every account, so the first click narrows rather than starting from nothing.
  it('unticking one of all accounts leaves the rest', () => {
    expect(toggleAccountScope([], all, 'b')).toEqual(['a', 'c'])
  })

  it('ticking the last missing account collapses back to all', () => {
    expect(toggleAccountScope(['a', 'c'], all, 'b')).toEqual([])
  })

  it('narrows further within a selection', () => {
    expect(toggleAccountScope(['a', 'c'], all, 'c')).toEqual(['a'])
  })

  it('adds to a selection', () => {
    expect(toggleAccountScope(['a'], all, 'b')).toEqual(['a', 'b'])
  })

  // Otherwise a single account would be the one case where the list can never be empty.
  it('a single account stays all accounts', () => {
    expect(toggleAccountScope([], ['a'], 'a')).toEqual([])
  })

  // A stale entry listing every account must not be read as a narrower scope.
  it('a selection of everything is all accounts', () => {
    expect(toggleAccountScope(['a', 'b'], all, 'c')).toEqual([])
  })
})

describe('suggestSavedSearchName', () => {
  it('uses a short query as it stands', () => {
    expect(suggestSavedSearchName('  betreff:Rechnung ')).toBe('betreff:Rechnung')
  })

  it('cuts a long query at a word boundary', () => {
    const name = suggestSavedSearchName('von:buchhaltung@example.com betreff:Mahnung nach:2026-01-01')
    expect(name).toBe('von:buchhaltung@example.com…')
  })
})
