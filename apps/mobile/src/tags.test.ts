import { describe, expect, it } from 'vitest'
import { TAG_COLORS } from '@peregrine/core/tags'
import { createTag, listTags, shownTags, tagCoverage, UNKNOWN_TAG_COLOR, type Tag } from './tags'
import { migratedDatabase } from './testing/testDb'

const tag = (keyword: string, name = keyword, color = '#2f5d9f', sortOrder = 0): Tag => ({ id: keyword, name, keyword, color, sortOrder })

describe('making a tag', () => {
  it('has the name the user typed, a keyword the server accepts made of it, and a colour', async () => {
    const { db } = await migratedDatabase()
    const made = await createTag(db, '  Für später  ')
    expect(made).toMatchObject({ name: 'Für später', keyword: 'Fuer_spaeter', color: TAG_COLORS[0], sortOrder: 0 })
    expect(await listTags(db)).toEqual([made])
  })

  it('goes on in the order the tags were made, with the next colour of the palette', async () => {
    const { db } = await migratedDatabase()
    await createTag(db, 'One')
    const second = await createTag(db, 'Two')
    expect(second).toMatchObject({ sortOrder: 1, color: TAG_COLORS[1] })
    expect((await listTags(db)).map((made) => made.name)).toEqual(['One', 'Two'])
  })

  it('takes the colour that is asked for', async () => {
    const { db } = await migratedDatabase()
    expect(await createTag(db, 'Work', '#b03d33')).toMatchObject({ color: '#b03d33' })
  })

  it('is the tag there is already when the name comes to a keyword that is taken, in any case', async () => {
    const { db } = await migratedDatabase()
    const first = await createTag(db, 'Für später')
    expect(await createTag(db, 'fuer später')).toEqual(first)
    expect(await createTag(db, 'FUER_SPAETER')).toEqual(first)
    expect(await listTags(db)).toHaveLength(1)
  })

  it('is no tag for a name that is nothing', async () => {
    const { db } = await migratedDatabase()
    expect(await createTag(db, '   ')).toBeUndefined()
    expect(await listTags(db)).toEqual([])
  })
})

describe('the tags a message has', () => {
  const mine = [tag('Work', 'Work', '#b03d33', 0), tag('Fuer_spaeter', 'Für später', '#2a7a4f', 1)]

  it('are its keywords that are tags, as the user named and coloured them, in the order the tags were made', () => {
    expect(shownTags(['\\Seen', 'Fuer_spaeter', 'Work'], mine)).toEqual([
      { keyword: 'Work', name: 'Work', color: '#b03d33' },
      { keyword: 'Fuer_spaeter', name: 'Für später', color: '#2a7a4f' }
    ])
  })

  it('know a keyword in whatever case the server has it', () => {
    expect(shownTags(['WORK'], mine)).toEqual([{ keyword: 'Work', name: 'Work', color: '#b03d33' }])
  })

  it('leave out what is a flag of the system and not a tag', () => {
    expect(shownTags(['\\Seen', '\\Flagged', '$Forwarded', '$Junk'], mine)).toEqual([])
  })

  it('show a keyword that nobody made a tag of by what it is, after the others, in a colour of its own', () => {
    expect(shownTags(['Zebra_stripes', 'Work', 'Alpha'], mine)).toEqual([
      { keyword: 'Work', name: 'Work', color: '#b03d33' },
      { keyword: 'Alpha', name: 'Alpha', color: UNKNOWN_TAG_COLOR },
      { keyword: 'Zebra_stripes', name: 'Zebra stripes', color: UNKNOWN_TAG_COLOR }
    ])
  })
})

describe('how many of the chosen messages have a tag', () => {
  it('is none, some or all of them, without regard to case', () => {
    expect(tagCoverage([['Work'], ['work', '\\Seen'], []], 'Work')).toBe('some')
    expect(tagCoverage([['Work'], ['WORK']], 'work')).toBe('all')
    expect(tagCoverage([['Other'], []], 'Work')).toBe('none')
  })

  it('is none when nothing is chosen', () => {
    expect(tagCoverage([], 'Work')).toBe('none')
  })
})
