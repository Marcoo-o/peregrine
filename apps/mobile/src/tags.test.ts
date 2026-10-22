import { describe, expect, it } from 'vitest'
import { TAG_COLORS } from '@peregrine/core/tags'
import { createTag, deleteTag, listTags, shownTags, tagCoverage, UNKNOWN_TAG_COLOR, updateTag, type Tag } from './tags'
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

describe('changing a tag', () => {
  it('renames it and recolours it, and the keyword stays what it was, since the messages carry that', async () => {
    const { db } = await migratedDatabase()
    const made = (await createTag(db, 'Work'))!
    expect(await updateTag(db, made.id, '  Arbeit  ', '#2a7a4f')).toBe(true)
    expect(await listTags(db)).toEqual([{ ...made, name: 'Arbeit', color: '#2a7a4f' }])
  })

  it('changes nothing for a name that is nothing', async () => {
    const { db } = await migratedDatabase()
    const made = (await createTag(db, 'Work'))!
    expect(await updateTag(db, made.id, '   ', '#2a7a4f')).toBe(false)
    expect(await listTags(db)).toEqual([made])
  })

  it('leaves the others as they are, and a tag that is not there as nothing', async () => {
    const { db } = await migratedDatabase()
    const first = (await createTag(db, 'One'))!
    const second = (await createTag(db, 'Two'))!
    await updateTag(db, first.id, 'Uno', first.color)
    await updateTag(db, 'nothing', 'Ghost', first.color)
    expect((await listTags(db)).map((tag) => tag.name)).toEqual(['Uno', 'Two'])
    expect((await listTags(db))[1]).toEqual(second)
  })
})

describe('forgetting a tag', () => {
  it('takes the definition and leaves the others', async () => {
    const { db } = await migratedDatabase()
    const first = (await createTag(db, 'One'))!
    const second = (await createTag(db, 'Two'))!
    await deleteTag(db, first.id)
    expect(await listTags(db)).toEqual([second])
  })

  it('leaves the keyword on the messages, which show it by its keyword in grey after that', async () => {
    const { db } = await migratedDatabase()
    const made = (await createTag(db, 'Für später'))!
    const flags = ['Fuer_spaeter']
    expect(shownTags(flags, await listTags(db))).toEqual([{ keyword: 'Fuer_spaeter', name: 'Für später', color: made.color }])
    await deleteTag(db, made.id)
    expect(shownTags(flags, await listTags(db))).toEqual([{ keyword: 'Fuer_spaeter', name: 'Fuer spaeter', color: UNKNOWN_TAG_COLOR }])
  })

  it('can be made again with the same name, which is the same keyword', async () => {
    const { db } = await migratedDatabase()
    const first = (await createTag(db, 'Work'))!
    await deleteTag(db, first.id)
    expect(await createTag(db, 'Work')).toMatchObject({ keyword: 'Work', name: 'Work' })
  })
})
