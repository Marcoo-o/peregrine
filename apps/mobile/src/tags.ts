import { isTagKeyword, keywordFor, TAG_COLORS, type Tag } from '@peregrine/core/tags'
import type { SqlDb } from '@peregrine/core/sqlDb'
import { newId } from './ids'

export type { Tag }

interface TagRow {
  id: string
  name: string
  keyword: string
  color: string
  sort_order: number
}

const toTag = (row: TagRow): Tag => ({ id: row.id, name: row.name, keyword: row.keyword, color: row.color, sortOrder: row.sort_order })

/** The tags the user has made, in the order they were made. */
export async function listTags(db: SqlDb): Promise<Tag[]> {
  const rows = await db.all<TagRow>('SELECT id, name, keyword, color, sort_order FROM tags ORDER BY sort_order, name')
  return rows.map(toTag)
}

/**
 * Makes a tag. Its keyword is made of its name the way the desktop does it, since a keyword that the server does not
 * accept is a tag that does not stick. A name that comes to a keyword there is already is that tag: it is returned and
 * not made twice, which two keywords that differ in case only would be to IMAP, which compares them without case.
 * Returns undefined for a name that is nothing but spaces.
 */
export async function createTag(db: SqlDb, name: string, color?: string): Promise<Tag | undefined> {
  const trimmed = name.trim()
  if (trimmed === '') return undefined
  const existing = await listTags(db)
  const keyword = keywordFor(trimmed)
  const same = existing.find((tag) => tag.keyword.toLowerCase() === keyword.toLowerCase())
  if (same) return same
  const tag: Tag = {
    id: newId(),
    name: trimmed,
    keyword,
    color: color ?? TAG_COLORS[existing.length % TAG_COLORS.length],
    sortOrder: existing.length === 0 ? 0 : Math.max(...existing.map((other) => other.sortOrder)) + 1
  }
  await db.run('INSERT INTO tags (id, name, keyword, color, sort_order) VALUES (?, ?, ?, ?, ?)', tag.id, tag.name, tag.keyword, tag.color, tag.sortOrder)
  return tag
}

/**
 * Renames a tag or gives it another colour, as the desktop does. The keyword stays as it was: it is what the messages
 * carry on the server, and a new one would leave the tag on none of them. A name that is nothing changes nothing.
 * Returns whether it was changed.
 */
export async function updateTag(db: SqlDb, id: string, name: string, color: string): Promise<boolean> {
  const trimmed = name.trim()
  if (trimmed === '') return false
  await db.run('UPDATE tags SET name = ?, color = ? WHERE id = ?', trimmed, color, id)
  return true
}

/**
 * Forgets a tag, as the desktop does: the definition goes, and the keyword stays on the messages that have it, which
 * then show it by its keyword, in grey. Taking it off every message would mean rewriting mail that this phone has not
 * all fetched, and the keyword may be in use by another client under a name of its own.
 */
export async function deleteTag(db: SqlDb, id: string): Promise<void> {
  await db.run('DELETE FROM tags WHERE id = ?', id)
}

/** A tag as a message shows it. */
export interface ShownTag {
  keyword: string
  name: string
  color: string
}

/** What a keyword that nobody made a tag of looks like: it was set by another client, and is shown by what it is. */
export const UNKNOWN_TAG_COLOR = '#4a5765'

/**
 * The tags a message has, from its flags: the keywords that are tags, each as the user named it and coloured it
 * where it is one of theirs, in the order the tags were made, and the others after them, by their keyword.
 */
export function shownTags(flags: readonly string[], tags: readonly Tag[]): ShownTag[] {
  const keywords = flags.filter(isTagKeyword)
  const known = tags
    .filter((tag) => keywords.some((keyword) => keyword.toLowerCase() === tag.keyword.toLowerCase()))
    .map((tag) => ({ keyword: tag.keyword, name: tag.name, color: tag.color }))
  const others = keywords
    .filter((keyword) => !tags.some((tag) => tag.keyword.toLowerCase() === keyword.toLowerCase()))
    .sort((a, b) => a.localeCompare(b))
    .map((keyword) => ({ keyword, name: keyword.replace(/_/g, ' '), color: UNKNOWN_TAG_COLOR }))
  return [...known, ...others]
}

/** Whether none, some or all of the messages have a tag, which is what a choice of several shows for each tag. */
export function tagCoverage(flagLists: readonly (readonly string[])[], keyword: string): 'none' | 'some' | 'all' {
  if (flagLists.length === 0) return 'none'
  const has = flagLists.filter((flags) => flags.some((flag) => flag.toLowerCase() === keyword.toLowerCase())).length
  if (has === 0) return 'none'
  return has === flagLists.length ? 'all' : 'some'
}
