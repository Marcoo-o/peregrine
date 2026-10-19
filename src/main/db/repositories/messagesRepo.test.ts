import { describe, expect, it } from 'vitest'
import type { MessageSort } from '@peregrine/core/types'
import {
  buildFilterSql,
  buildFtsMatchQuery,
  buildKeysetSql,
  buildOrderBy,
  buildSearchClause,
  decodeCursor,
  encodeCursor,
  buildPageSql,
  shouldMergePerFolder,
  type PageCursor
} from './messagesRepo'

describe('buildOrderBy', () => {
  it('sorts by the requested column in the requested direction', () => {
    expect(buildOrderBy({ field: 'date', direction: 'desc' })).toBe(
      "COALESCE(date, '') DESC, m.rowid DESC"
    )
    expect(buildOrderBy({ field: 'size', direction: 'asc' })).toBe(
      'COALESCE(size_bytes, 0) ASC, m.rowid ASC'
    )
  })

  it('sorts text columns case-insensitively', () => {
    expect(buildOrderBy({ field: 'subject', direction: 'asc' })).toContain('COLLATE NOCASE')
  })

  it('falls back to the sender address when no display name is stored', () => {
    expect(buildOrderBy({ field: 'from', direction: 'desc' })).toContain(
      "COALESCE(NULLIF(from_name, ''), from_address, '')"
    )
  })

  // A comparison against NULL is neither true nor false, so a single message without a
  // subject would drop out of the list at a page boundary and nothing would say so.
  it('no sort key can ever be NULL', () => {
    for (const field of ['date', 'subject', 'from', 'size'] as const) {
      expect(buildOrderBy({ field, direction: 'asc' })).toContain('COALESCE')
    }
  })

  // uid is unique inside one folder; a unified view spans folders, and a tie-breaker that
  // ties is not one.
  it('breaks ties on rowid, in the same direction as the sort', () => {
    expect(buildOrderBy({ field: 'subject', direction: 'asc' })).toMatch(/m\.rowid ASC$/)
    expect(buildOrderBy({ field: 'subject', direction: 'desc' })).toMatch(/m\.rowid DESC$/)
  })
})

describe('Seitencursor', () => {
  const sort: MessageSort = { field: 'date', direction: 'desc' }
  const cursor: PageCursor = { total: 42, key: ['2026-08-07', 17], sort: 'date:desc' }

  it('round-trips', () => {
    expect(decodeCursor(encodeCursor(cursor), sort)).toEqual(cursor)
  })

  it('starts from the top when there is no cursor', () => {
    expect(decodeCursor(undefined, sort)).toBeNull()
    expect(decodeCursor('', sort)).toBeNull()
  })

  it('refuses anything unreadable rather than guessing', () => {
    expect(decodeCursor('kaputt', sort)).toBeNull()
    expect(decodeCursor('{"total":1}', sort)).toBeNull()
    expect(decodeCursor('{"total":"viele","key":["a",1],"sort":"date:desc"}', sort)).toBeNull()
    expect(decodeCursor('{"total":1,"key":["a"],"sort":"date:desc"}', sort)).toBeNull()
  })

  // Re-sorting while scrolled down would otherwise continue from a key that means nothing
  // in the new order. And silently return the wrong rows rather than an error.
  it('a cursor does not survive a change of sort', () => {
    expect(decodeCursor(encodeCursor(cursor), { field: 'subject', direction: 'desc' })).toBeNull()
    expect(decodeCursor(encodeCursor(cursor), { field: 'date', direction: 'asc' })).toBeNull()
  })
})

describe('buildKeysetSql', () => {
  it('the first page has no condition', () => {
    expect(buildKeysetSql({ field: 'date', direction: 'desc' }, null)).toEqual({
      sql: '',
      params: []
    })
  })

  it('descending asks for everything below the last row', () => {
    const built = buildKeysetSql(
      { field: 'date', direction: 'desc' },
      { total: 9, key: ['2026-08-07', 17], sort: 'date:desc' }
    )
    expect(built.sql).toBe(" AND (COALESCE(date, ''), m.rowid) < (?, ?)")
    expect(built.params).toEqual(['2026-08-07', 17])
  })

  it('ascending asks for everything above it', () => {
    const built = buildKeysetSql(
      { field: 'size', direction: 'asc' },
      { total: 9, key: [1024, 3], sort: 'size:asc' }
    )
    expect(built.sql).toBe(' AND (COALESCE(size_bytes, 0), m.rowid) > (?, ?)')
    expect(built.params).toEqual([1024, 3])
  })

  // The comparison has to name the same expression the ORDER BY sorts on, or the page
  // boundary lands somewhere else entirely.
  it('compares on the same expression it sorts by', () => {
    for (const field of ['date', 'subject', 'from', 'size'] as const) {
      const sort: MessageSort = { field, direction: 'desc' }
      const expression = buildOrderBy(sort).split(' DESC')[0]
      expect(buildKeysetSql(sort, { total: 1, key: ['x', 1], sort: `${field}:desc` }).sql).toContain(
        expression
      )
    }
  })
})

describe('buildFilterSql', () => {
  it('adds nothing without active quick filters', () => {
    expect(buildFilterSql(undefined)).toBe('')
    expect(buildFilterSql({})).toBe('')
  })

  it('combines the active filters with AND', () => {
    expect(buildFilterSql({ unreadOnly: true })).toBe(' AND is_read = 0')
    expect(buildFilterSql({ unreadOnly: true, flaggedOnly: true, attachmentsOnly: true })).toBe(
      ' AND is_read = 0 AND is_flagged = 1 AND has_attachments = 1'
    )
  })

  it('ignores filters that are explicitly switched off', () => {
    expect(buildFilterSql({ unreadOnly: false, flaggedOnly: true })).toBe(' AND is_flagged = 1')
  })
})

describe('buildFtsMatchQuery', () => {
  it('turns every term into a quoted prefix match', () => {
    expect(buildFtsMatchQuery('rechnung')).toBe('"rechnung"*')
    expect(buildFtsMatchQuery('exklusive tickets')).toBe('"exklusive"* "tickets"*')
  })

  it('collapses surrounding and repeated whitespace', () => {
    expect(buildFtsMatchQuery('  versand   bonus ')).toBe('"versand"* "bonus"*')
  })

  it('escapes quotes so a query cannot break out of the FTS string', () => {
    expect(buildFtsMatchQuery('say "hi"')).toBe('"say"* """hi"""*')
  })

  it('returns an empty query for blank input, which callers treat as "no search"', () => {
    expect(buildFtsMatchQuery('   ')).toBe('')
  })
})

describe('buildSearchClause', () => {
  it('contributes nothing without a query, so the list stays a plain folder listing', () => {
    expect(buildSearchClause(undefined)).toEqual({ sql: '', params: [], matchesNothing: false })
    expect(buildSearchClause('   ')).toEqual({ sql: '', params: [], matchesNothing: false })
  })

  it('matches free text through the index', () => {
    const clause = buildSearchClause('rechnung')
    expect(clause.sql).toContain('messages_fts MATCH ?')
    expect(clause.params).toEqual(['"rechnung"*'])
  })

  // Operators work on messages whose body was never fetched, so they must not need the index.
  it('leaves the index out when the query is operators only', () => {
    const clause = buildSearchClause('von:chef@example.com ist:ungelesen')
    expect(clause.sql).not.toContain('messages_fts')
    expect(clause.sql).toContain('m.is_read = 0')
    expect(clause.params).toEqual(['%chef@example.com%', '%chef@example.com%'])
  })

  it('puts the match parameter before the operator parameters, as the SQL reads them', () => {
    const clause = buildSearchClause('mahnung betreff:Rechnung')
    expect(clause.params).toEqual(['"mahnung"*', '%Rechnung%'])
  })

  // "everything" is the one answer a saved search never means.
  it('reports a query that can match nothing instead of matching everything', () => {
    expect(buildSearchClause('""').matchesNothing).toBe(true)
  })
})

describe('buildPageSql', () => {
  const sort: MessageSort = { field: 'date', direction: 'desc' }

  // The form the application used throughout, and still the right one for a mailbox of
  // ordinary size. The decision is made by `shouldMergePerFolder`, not here.
  it('reads all folders at once when not merging', () => {
    const sql = buildPageSql(['f1', 'f2'], sort, '', '', false)
    expect(sql).not.toContain('UNION ALL')
    expect(sql).toContain('folder_id IN (?, ?)')
  })

  /**
   * The whole point. `folder_id IN (?, ?, ?)` made SQLite sort every matching row of every
   * folder in a temp B-tree to hand back fifty. 276 ms at 100.000 messages, against 1,1 ms
   * for this form.
   */
  it('reads each folder on its own and merges the parts', () => {
    const sql = buildPageSql(['f1', 'f2', 'f3'], sort, '', '', true)
    expect(sql.match(/UNION ALL/g)).toHaveLength(2)
    expect(sql.match(/m\.folder_id = \?/g)).toHaveLength(3)
    expect(sql).not.toContain('folder_id IN')
  })

  // Each part must stop after a page: that is what keeps the merge small. Plus the outer
  // limit, so the merged result is a page again.
  it('limits every part and the merge', () => {
    const sql = buildPageSql(['f1', 'f2'], sort, '', '', true)
    expect(sql.match(/LIMIT \?/g)).toHaveLength(3)
  })

  /**
   * Outside the parts the keyset would filter after the fact: every folder would offer its
   * own first fifty rows again on each page, the merge would drop them, and page two would
   * come back empty with rows left behind.
   */
  it('puts the keyset inside each part, not around the merge', () => {
    const keyset = buildKeysetSql(sort, { total: 100, key: ['2026-01-01', 42], sort: 'date:desc' })
      .sql
    const sql = buildPageSql(['f1', 'f2'], sort, '', keyset, true)
    const parts = sql.split('UNION ALL')
    expect(parts).toHaveLength(2)
    for (const part of parts) expect(part).toContain('m.rowid) < (?, ?)')
  })

  // The outer ORDER BY sorts the projected column; `m` no longer exists there, so the
  // collation has to be repeated or a subject sort would silently become case-sensitive.
  it('carries the collation into the outer sort', () => {
    const sql = buildPageSql(['f1', 'f2'], { field: 'subject', direction: 'asc' }, '', '', true)
    expect(sql).toContain('ORDER BY sort_key COLLATE NOCASE ASC, row_id ASC')
  })

  it('does not add a collation where the sort key is a number', () => {
    const sql = buildPageSql(['f1', 'f2'], { field: 'size', direction: 'desc' }, '', '', true)
    expect(sql).toContain('ORDER BY sort_key DESC, row_id DESC')
    expect(sql).not.toContain('sort_key COLLATE')
  })

  // Same direction inside and outside: a part sorted the other way would hand up its *last*
  // rows as candidates, and the merge cannot invent the ones it never saw.
  it('sorts the parts and the merge the same way', () => {
    const sql = buildPageSql(['f1', 'f2'], { field: 'date', direction: 'asc' }, '', '', true)
    expect(sql.match(/ASC/g)?.length).toBeGreaterThanOrEqual(4)
    expect(sql).not.toContain('DESC')
  })
})

/**
 * The rule that decides, and the reason there is a rule at all.
 *
 * The per folder form is not better across the board. On the mailbox this was built against,
 * 2571 messages across 95 folders, it is 3.6 times *slower*, because 95 index seeks cost more
 * than sorting 2571 rows. Shipping it unconditionally would have made the everyday case worse
 * in the name of a speed up.
 */
describe('shouldMergePerFolder', () => {
  it('a single folder is never merged - there is nothing to merge', () => {
    expect(shouldMergePerFolder(1, 1_000_000, 50)).toBe(false)
    expect(shouldMergePerFolder(0, 1_000_000, 50)).toBe(false)
  })

  // The mailbox that was measured. Here the older form wins by a wide margin.
  it('leaves a small mailbox spread over many folders alone', () => {
    expect(shouldMergePerFolder(95, 2571, 50)).toBe(false)
  })

  // And the measured counter case, 100,000 messages in four folders, 276 ms against 1.1 ms.
  it('merges once the folders are genuinely full', () => {
    expect(shouldMergePerFolder(4, 100_000, 50)).toBe(true)
  })

  /**
   * Every point of the measurement series, in both directions. 200 rows per folder still
   * belong to the older form, 1000 to the newer one, and that holds no matter how many folders
   * there are, because both costs hang on the same quantity, how full a single folder is.
   */
  it('agrees with every measured point', () => {
    for (const ordner of [4, 20, 95]) {
      for (const jeOrdner of [10, 50, 200]) {
        expect(shouldMergePerFolder(ordner, ordner * jeOrdner, 50)).toBe(false)
      }
      for (const jeOrdner of [1000, 5000]) {
        expect(shouldMergePerFolder(ordner, ordner * jeOrdner, 50)).toBe(true)
      }
    }
  })

  // The threshold hangs on the page size rather than on a fixed row count. A larger page lets
  // each part contribute more and moves the crossover with it.
  it('scales with the page size', () => {
    expect(shouldMergePerFolder(4, 4 * 400, 50)).toBe(false)
    expect(shouldMergePerFolder(4, 4 * 400, 20)).toBe(true)
  })
})
