/**
 * Saved searches: a stored query that appears in the sidebar and behaves like a folder.
 *
 * They live as JSON in `app_settings` rather than in their own table. A saved search owns no
 * mail. It is a question, and the answer is recomputed from the messages that are there.
 * There is nothing to migrate, nothing to keep in sync, and a broken entry costs at most one
 * sidebar row.
 */

export interface SavedSearch {
  id: string
  name: string
  /** In the same syntax as the search bar, operators included. */
  query: string
  /** Dot colour in the sidebar. */
  color: string
  /** Empty means every account. */
  accountIds: string[]
  /**
   * Trash and junk stay out unless asked for. A saved search usually asks "where is that
   * mail", and the copy in the trash is the one answer nobody means.
   */
  includeTrash: boolean
}

export const SAVED_SEARCH_COLORS = [
  '#4f7cff',
  '#12a594',
  '#e5484d',
  '#f5a524',
  '#8e4ec6',
  '#3b7c3e'
] as const

export const DEFAULT_SAVED_SEARCH_COLOR = SAVED_SEARCH_COLORS[0]

/** More than this many is a sign of a corrupted value, not of an enthusiastic user. */
const MAX_SAVED_SEARCHES = 50

const HEX_COLOR = /^#[0-9a-f]{6}$/i

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Reads the stored list, dropping anything that cannot be displayed.
 *
 * Repairing beats rejecting: the value is one JSON string for the whole list, so a single
 * damaged entry must not cost the others. An entry without a name or a query is dropped
 * because it would show as an unclickable blank row with no way to remove it.
 */
export function parseSavedSearches(raw: string | undefined): SavedSearch[] {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const seen = new Set<string>()
  const result: SavedSearch[] = []
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue
    const entry = item as Record<string, unknown>
    const id = asString(entry.id)
    const name = asString(entry.name)
    const query = asString(entry.query)
    if (!id || !name || !query || seen.has(id)) continue
    seen.add(id)

    const color = asString(entry.color)
    result.push({
      id,
      name,
      query,
      color: HEX_COLOR.test(color) ? color : DEFAULT_SAVED_SEARCH_COLOR,
      accountIds: Array.isArray(entry.accountIds)
        ? entry.accountIds.filter((value): value is string => typeof value === 'string')
        : [],
      includeTrash: entry.includeTrash === true
    })
    if (result.length >= MAX_SAVED_SEARCHES) break
  }
  return result
}

export function serializeSavedSearches(searches: SavedSearch[]): string {
  return JSON.stringify(searches.slice(0, MAX_SAVED_SEARCHES))
}

/** Inserts or replaces by id, keeping the existing position when it is a replacement. */
export function upsertSavedSearch(searches: SavedSearch[], entry: SavedSearch): SavedSearch[] {
  const index = searches.findIndex((search) => search.id === entry.id)
  if (index === -1) return [...searches, entry]
  const next = [...searches]
  next[index] = entry
  return next
}

export function removeSavedSearch(searches: SavedSearch[], id: string): SavedSearch[] {
  return searches.filter((search) => search.id !== id)
}

/**
 * Ticks or unticks one account in the scope of a search.
 *
 * The stored form has two meanings for one value: an empty list is "every account", not "no
 * account". So unticking the first box has to start from the full list, and ticking the last
 * missing one has to collapse back to empty. Otherwise a search would end up listing exactly
 * the accounts that exist today, and would quietly leave out the one added next week.
 */
export function toggleAccountScope(
  accountIds: string[],
  allAccountIds: string[],
  id: string
): string[] {
  const base = accountIds.length === 0 ? allAccountIds : accountIds
  const next = base.includes(id)
    ? base.filter((value) => value !== id)
    : [...base.filter((value) => value !== id), id]
  return next.length === allAccountIds.length ? [] : next
}

/**
 * A name for a search the user did not name.
 *
 * The query itself is the honest label, but a long one would push everything else out of the
 * sidebar, so it is cut at a word boundary where there is one.
 */
export function suggestSavedSearchName(query: string): string {
  const trimmed = query.trim()
  if (trimmed.length <= 28) return trimmed
  const cut = trimmed.slice(0, 28)
  const lastSpace = cut.lastIndexOf(' ')
  return `${lastSpace > 12 ? cut.slice(0, lastSpace) : cut}…`
}
