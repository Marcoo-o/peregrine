import type { SqlDb } from '../sqlDb'
import { randomUUID } from 'node:crypto'
import type { Tag } from '@peregrine/core/types'
import { keywordFor } from '@peregrine/core/tags'

interface TagRow {
  id: string
  name: string
  keyword: string
  color: string
  sort_order: number
}

const toTag = (row: TagRow): Tag => ({
  id: row.id,
  name: row.name,
  keyword: row.keyword,
  color: row.color,
  sortOrder: row.sort_order
})

export async function listTags(db: SqlDb): Promise<Tag[]> {
  return (await db.all<TagRow>('SELECT * FROM tags ORDER BY sort_order, name')).map(toTag)
}

export async function getTag(db: SqlDb, tagId: string): Promise<Tag | undefined> {
  const row = await db.get<TagRow>('SELECT * FROM tags WHERE id = ?', tagId)
  return row ? toTag(row) : undefined
}

/**
 * Creates a tag, giving it a keyword that is free.
 *
 * Two different names can fold to the same keyword ("Für später" and "Fuer spaeter"), and the
 * keyword is what the server stores. So a collision would silently merge two tags into one.
 */
export async function createTag(db: SqlDb, name: string, color: string): Promise<string> {
  const id = randomUUID()
  // Looking for a free keyword and taking it are one step. Two tags created at once would
  // otherwise both find the same keyword free.
  await db.transaction(async (tx) => {
    const base = keywordFor(name)
    let keyword = base
    let suffix = 2
    while (await tx.get('SELECT 1 FROM tags WHERE keyword = ?', keyword)) {
      keyword = `${base}_${suffix++}`
    }

    const next = (
      await tx.get<{ n: number }>('SELECT COALESCE(MAX(sort_order), -1) + 1 as n FROM tags')
    )!.n
    await tx.run(
      'INSERT INTO tags (id, name, keyword, color, sort_order) VALUES (?, ?, ?, ?, ?)',
      id,
      name,
      keyword,
      color,
      next
    )
  })
  return id
}

/**
 * Renames a tag or recolours it.
 *
 * The keyword deliberately stays as it was: it is what every message already carries on the
 * server, and changing it would mean rewriting the flags of every tagged message. And losing
 * the tag on any message this app has not synced.
 */
export async function updateTag(
  db: SqlDb,
  tagId: string,
  name: string,
  color: string
): Promise<void> {
  await db.run('UPDATE tags SET name = ?, color = ? WHERE id = ?', name, color, tagId)
}

export async function deleteTag(db: SqlDb, tagId: string): Promise<void> {
  await db.run('DELETE FROM tags WHERE id = ?', tagId)
}
