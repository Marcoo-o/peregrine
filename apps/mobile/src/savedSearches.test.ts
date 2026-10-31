import { describe, expect, it } from 'vitest'
import { appHarness } from './testing/appHarness'
import { MAX_SAVED, listSavedSearches, nameOf, removeSavedSearch, renameSavedSearch, saveSearch, savedSearchFor } from './savedSearches'
import { loadSidebar } from './sidebar'
import { migratedDatabase } from './testing/testDb'

describe('the searches that are kept', () => {
  it('are none to begin with, and are kept in the order they were saved', async () => {
    const { db } = await migratedDatabase()
    expect(await listSavedSearches(db)).toEqual([])
    await saveSearch(db, 'ist:ungelesen')
    await saveSearch(db, 'von:anna hat:anhang')
    expect((await listSavedSearches(db)).map((search) => search.query)).toEqual(['ist:ungelesen', 'von:anna hat:anhang'])
  })

  it('have the search for their name, on one line and not longer than a row', async () => {
    expect(nameOf('  ist:ungelesen \n  hat:anhang ')).toBe('ist:ungelesen hat:anhang')
    expect(nameOf('x'.repeat(60))).toHaveLength(40)
    expect(nameOf('x'.repeat(60)).endsWith('…')).toBe(true)
  })

  it('are not kept twice, whatever the case or the spaces, and the one that is there is the answer', async () => {
    const { db } = await migratedDatabase()
    const first = await saveSearch(db, 'Budget  2026')
    const again = await saveSearch(db, ' budget 2026 ')
    expect(again.saved).toEqual(first.saved)
    expect(await listSavedSearches(db)).toHaveLength(1)
  })

  it('are not kept for an empty query, nor beyond the most there can be, and say which', async () => {
    const { db } = await migratedDatabase()
    expect(await saveSearch(db, '   ')).toEqual({ saved: null, reason: 'empty' })
    for (let n = 0; n < MAX_SAVED; n++) await saveSearch(db, `word${n}`)
    expect(await saveSearch(db, 'one more')).toEqual({ saved: null, reason: 'full' })
    expect(await listSavedSearches(db)).toHaveLength(MAX_SAVED)
  })

  it('can be taken away, and a search that is not there is not an error', async () => {
    const { db } = await migratedDatabase()
    const kept = (await saveSearch(db, 'a')).saved!
    await saveSearch(db, 'b')
    expect(await removeSavedSearch(db, kept.id)).toBe(true)
    expect(await removeSavedSearch(db, kept.id)).toBe(false)
    expect((await listSavedSearches(db)).map((search) => search.query)).toEqual(['b'])
  })

  it('are found by their query, and a query that is not kept finds nothing', async () => {
    const { db } = await migratedDatabase()
    const kept = (await saveSearch(db, 'Von:Anna')).saved!
    expect(await savedSearchFor(db, ' von:anna ')).toEqual(kept)
    expect(await savedSearchFor(db, 'other')).toBeUndefined()
    expect(await savedSearchFor(db, '')).toBeUndefined()
  })

  it('leave out what is stored that is not a search, and what is not JSON', async () => {
    const { db } = await migratedDatabase()
    await db.run("INSERT INTO settings (name, value) VALUES ('savedSearches', ?)", JSON.stringify([{ id: 'a', name: 'n', query: 'q' }, { id: 1 }, 'x', null]))
    expect(await listSavedSearches(db)).toEqual([{ id: 'a', name: 'n', query: 'q' }])
    await db.run("UPDATE settings SET value = 'not json' WHERE name = 'savedSearches'")
    expect(await listSavedSearches(db)).toEqual([])
    await db.run("UPDATE settings SET value = '{}' WHERE name = 'savedSearches'")
    expect(await listSavedSearches(db)).toEqual([])
  })

  it('are in the sidebar', async () => {
    const { db } = await migratedDatabase()
    await saveSearch(db, 'ist:markiert')
    expect((await loadSidebar(db)).searches.map((search) => search.query)).toEqual(['ist:markiert'])
  })
})

describe('keeping the search that is shown', () => {
  it('keeps it and says so, and the screen knows it is kept, and takes it away again', async () => {
    const t = await appHarness()
    await t.givenAccount('work', {})
    await t.app.navigator.showSearch('ist:ungelesen')
    expect(t.store.screen).toMatchObject({ name: 'search', saved: undefined })
    await t.app.navigator.saveCurrentSearch()
    expect(t.store.screen).toMatchObject({ saved: { query: 'ist:ungelesen' }, notice: expect.stringContaining('Seitenleiste') })
    await t.app.navigator.showSearch('ist:ungelesen')
    expect(t.store.screen).toMatchObject({ saved: { query: 'ist:ungelesen' } })
    await t.app.navigator.removeCurrentSearch()
    expect(t.store.screen).toMatchObject({ saved: undefined, notice: expect.stringContaining('entfernt') })
    expect(await listSavedSearches(t.db)).toEqual([])
  })

  it('says that there is nothing to keep for an empty search, and does nothing when no search is shown', async () => {
    const t = await appHarness()
    await t.app.navigator.showSearch('')
    await t.app.navigator.saveCurrentSearch()
    expect(t.store.screen).toMatchObject({ notice: 'Es gibt nichts zu behalten.' })
    t.store.showScreen({ name: 'login' })
    await t.app.navigator.saveCurrentSearch()
    await t.app.navigator.removeCurrentSearch()
    expect(t.store.screen.name).toBe('login')
  })
})

describe('naming a search that is kept', () => {
  it('shows the name in the sidebar, and the search itself again for an empty name', async () => {
    const t = await appHarness()
    await t.givenAccount('work', {})
    await t.app.navigator.showSearch('ist:ungelesen hat:anhang')
    await t.app.navigator.saveCurrentSearch()
    await t.app.navigator.renameCurrentSearch('  Unread   with files ')
    expect(t.store.screen).toMatchObject({ saved: { name: 'Unread with files', query: 'ist:ungelesen hat:anhang' }, notice: expect.stringContaining('Unread with files') })
    expect((await loadSidebar(t.db)).searches.map((search) => search.name)).toEqual(['Unread with files'])
    await t.app.navigator.renameCurrentSearch('')
    expect(t.store.screen).toMatchObject({ saved: { name: 'ist:ungelesen hat:anhang' } })
  })

  it('keeps a long name to what a row holds, and does nothing for a search that is not kept', async () => {
    const t = await appHarness()
    await t.givenAccount('work', {})
    await t.app.navigator.showSearch('x')
    await t.app.navigator.renameCurrentSearch('name')
    expect(await listSavedSearches(t.db)).toEqual([])
    await t.app.navigator.saveCurrentSearch()
    await t.app.navigator.renameCurrentSearch('n'.repeat(80))
    expect((await listSavedSearches(t.db))[0].name).toHaveLength(40)
    expect(await renameSavedSearch(t.db, 'nothing', 'x')).toBeUndefined()
  })
})
