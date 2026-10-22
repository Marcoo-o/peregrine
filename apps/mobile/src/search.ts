import { parseSearchQuery } from '@peregrine/core/searchQuery'
import type { SqlDb } from '@peregrine/core/sqlDb'
import { FLAGGED, SEEN } from './flags'
import type { Folder } from './folders'
import { toUnifiedMessage, UNIFIED_COLUMNS, type UnifiedMessage, type UnifiedRow } from './unified'

/** How many a search shows. A search that finds more than a screen can use is a search that is to be made narrower. */
export const SEARCH_LIMIT = 200

/** A message a search found: where it is and whose, and the folder it is in, which a list of inboxes does not need. */
export interface SearchHit extends UnifiedMessage {
  folder: Pick<Folder, 'imapPath' | 'displayName' | 'specialUse'>
}

export interface SearchResult {
  messages: SearchHit[]
  /** The parts of the search that the phone cannot do, by their field. The rest of the search was made without them. */
  unsupported: Array<'to'>
}

type Row = UnifiedRow & { folder_path: string; folder_name: string; folder_role: string | null }

/** What is looked for, as a pattern that means these characters and no others: `%` and `_` are not wildcards here. */
const containing = (word: string): string => `%${word.replace(/[!%_]/g, '!$&')}%`

/** The start of a day as the user's clock has it, which is what a date typed in a search means. */
const startOfDay = (isoDate: string): number => new Date(`${isoDate}T00:00:00`).getTime()

/** Messages that have a flag, and messages that do not. The flags are written as JSON and compared without regard to case. */
const FLAG_SET = 'EXISTS (SELECT 1 FROM json_each(m.flags) WHERE lower(json_each.value) = lower(?))'

/**
 * Looks through the messages that are stored on the phone, in every folder of every account, newest first.
 *
 * The syntax is the desktop's: words, `von:`, `betreff:`, `hat:anhang`, `ist:ungelesen`, `ist:markiert`, `vor:` and
 * `nach:`. Every word has to be in the subject, in who wrote or in the text, in any case. The text is what has been
 * fetched so far (see `bodyIndex.ts`), so a message whose text has not come yet is found by its headers only. What the
 * phone does not keep at all, the recipients, cannot be searched, and the search says so and goes on without it.
 */
export async function searchMessages(db: SqlDb, input: string, limit: number = SEARCH_LIMIT): Promise<SearchResult> {
  const query = parseSearchQuery(input)
  const unsupported: SearchResult['unsupported'] = query.to ? ['to'] : []

  const conditions: string[] = []
  const params: Array<string | number> = []
  const needs = (condition: string, ...values: Array<string | number>) => {
    conditions.push(condition)
    params.push(...values)
  }

  for (const word of query.text.split(/\s+/).filter(Boolean)) {
    needs(
      "(m.subject LIKE ? ESCAPE '!' OR m.sender LIKE ? ESCAPE '!' OR m.body_text LIKE ? ESCAPE '!')",
      containing(word),
      containing(word),
      containing(word)
    )
  }
  for (const word of (query.from ?? '').split(/\s+/).filter(Boolean)) needs("m.sender LIKE ? ESCAPE '!'", containing(word))
  for (const word of (query.subject ?? '').split(/\s+/).filter(Boolean)) needs("m.subject LIKE ? ESCAPE '!'", containing(word))
  if (query.hasAttachment) needs('m.has_attachment = 1')
  if (query.isUnread) needs(`NOT ${FLAG_SET}`, SEEN)
  if (query.isFlagged) needs(FLAG_SET, FLAGGED)
  if (query.after) needs('m.date_ms >= ?', startOfDay(query.after))
  if (query.before) needs('m.date_ms < ?', startOfDay(query.before))

  // Nothing to look for is not a search for everything: that would be a list, and there is one.
  if (conditions.length === 0) return { messages: [], unsupported }

  const rows = await db.all<Row>(
    `SELECT ${UNIFIED_COLUMNS}, f.imap_path AS folder_path, f.display_name AS folder_name, f.special_use AS folder_role
     FROM messages m
     JOIN folders f ON f.id = m.folder_id
     JOIN accounts a ON a.id = m.account_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY m.date_ms IS NULL, m.date_ms DESC, m.uid DESC
     LIMIT ?`,
    ...params,
    limit
  )
  return {
    messages: rows.map((row) => ({
      ...toUnifiedMessage(row),
      folder: { imapPath: row.folder_path, displayName: row.folder_name, specialUse: row.folder_role }
    })),
    unsupported
  }
}
