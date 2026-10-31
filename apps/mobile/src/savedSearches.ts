import type { SqlDb } from '@peregrine/core/sqlDb'
import { newId } from './ids'

/** A search that is kept, to be run again by a tap in the sidebar: what the desktop shows as a folder that is a search. */
export interface SavedSearch {
  id: string
  /** What the sidebar says: the search itself unless it was given another name. */
  name: string
  query: string
}

const NAME = 'savedSearches'

/** The most that are kept. A sidebar that is longer than a screen has stopped being a short way to anything. */
export const MAX_SAVED = 20

/** The searches as stored, in the order they were saved; anything that is not a search is left out. */
export async function listSavedSearches(db: SqlDb): Promise<SavedSearch[]> {
  const row = await db.get<{ value: string }>('SELECT value FROM settings WHERE name = ?', NAME)
  if (!row) return []
  try {
    const given = JSON.parse(row.value) as unknown
    if (!Array.isArray(given)) return []
    return given.filter(
      (item): item is SavedSearch =>
        typeof item === 'object' && item !== null && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.query === 'string'
    )
  } catch {
    return []
  }
}

async function write(db: SqlDb, searches: SavedSearch[]): Promise<void> {
  await db.run(
    `INSERT INTO settings (name, value) VALUES (?, ?)
     ON CONFLICT (name) DO UPDATE SET value = excluded.value`,
    NAME,
    JSON.stringify(searches)
  )
}

/** The words a search is called by in the sidebar when it was not named: the query, on one line and not longer than a row. */
export function nameOf(query: string): string {
  const text = query.replace(/\s+/g, ' ').trim()
  return text.length > 40 ? `${text.slice(0, 39)}…` : text
}

/**
 * Keeps a search. One that is kept already, whatever the case or the spaces, is not kept twice, and the one that is there is returned. Nothing is kept for
 * an empty query, nor beyond `MAX_SAVED`: the reason is `null` for both and the caller says what it was.
 */
export async function saveSearch(db: SqlDb, query: string): Promise<{ saved: SavedSearch | null; reason?: 'empty' | 'full' }> {
  const text = query.replace(/\s+/g, ' ').trim()
  if (text === '') return { saved: null, reason: 'empty' }
  const all = await listSavedSearches(db)
  const same = all.find((search) => search.query.replace(/\s+/g, ' ').trim().toLowerCase() === text.toLowerCase())
  if (same) return { saved: same }
  if (all.length >= MAX_SAVED) return { saved: null, reason: 'full' }
  const saved = { id: newId(), name: nameOf(text), query: text }
  await write(db, [...all, saved])
  return { saved }
}

/** Takes a saved search away, and says whether there was one. */
export async function removeSavedSearch(db: SqlDb, id: string): Promise<boolean> {
  const all = await listSavedSearches(db)
  const rest = all.filter((search) => search.id !== id)
  if (rest.length === all.length) return false
  await write(db, rest)
  return true
}

/** Gives a saved search another name; an empty name is the search itself again. Whether there was such a search. */
export async function renameSavedSearch(db: SqlDb, id: string, name: string): Promise<SavedSearch | undefined> {
  const all = await listSavedSearches(db)
  const found = all.find((search) => search.id === id)
  if (!found) return undefined
  const renamed = { ...found, name: name.trim() === '' ? nameOf(found.query) : name.replace(/\s+/g, ' ').trim().slice(0, 40) }
  await write(db, all.map((search) => (search.id === id ? renamed : search)))
  return renamed
}

/** The saved search that is this query, whatever the case or the spaces, or undefined. */
export async function savedSearchFor(db: SqlDb, query: string): Promise<SavedSearch | undefined> {
  const text = query.replace(/\s+/g, ' ').trim().toLowerCase()
  if (text === '') return undefined
  return (await listSavedSearches(db)).find((search) => search.query.replace(/\s+/g, ' ').trim().toLowerCase() === text)
}
