import { describe, expect, it } from 'vitest'
import type { FetchedMessage } from '@peregrine/core/imapSession'
import { TAG_COLORS } from '@peregrine/core/tags'
import { addAccount } from './accounts'
import { syncFolders } from './folders'
import { saveMessages } from './messages'
import {
  createTag,
  deleteTag,
  listTags,
  moveTag,
  shownTags,
  tagCounts,
  tagCoverage,
  UNKNOWN_TAG_COLOR,
  updateTag,
  type Tag
} from './tags'
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

describe('moving a tag', () => {
  async function three() {
    const { db } = await migratedDatabase()
    const [one, two, three] = [await createTag(db, 'One'), await createTag(db, 'Two'), await createTag(db, 'Three')]
    return { db, one: one!, two: two!, three: three! }
  }
  const names = async (db: Awaited<ReturnType<typeof three>>['db']) => (await listTags(db)).map((made) => made.name)

  it('puts it one place up or down, in front of the one it passes', async () => {
    const { db, two } = await three()
    expect(await moveTag(db, two.id, -1)).toBe(true)
    expect(await names(db)).toEqual(['Two', 'One', 'Three'])
    expect(await moveTag(db, two.id, 1)).toBe(true)
    expect(await moveTag(db, two.id, 1)).toBe(true)
    expect(await names(db)).toEqual(['One', 'Three', 'Two'])
  })

  it('does nothing at either end, and for a tag that is not there', async () => {
    const { db, one, three: last } = await three()
    expect(await moveTag(db, one.id, -1)).toBe(false)
    expect(await moveTag(db, last.id, 1)).toBe(false)
    expect(await moveTag(db, 'gone', 1)).toBe(false)
    expect(await names(db)).toEqual(['One', 'Two', 'Three'])
  })

  it('numbers the places again from the first, so that a tag that was forgotten leaves no gap', async () => {
    const { db, one, two, three: last } = await three()
    await deleteTag(db, two.id)
    await moveTag(db, last.id, -1)
    expect((await listTags(db)).map((made) => made.sortOrder)).toEqual([0, 1])
    expect(await names(db)).toEqual(['Three', 'One'])
    expect(one.id).toBeDefined()
  })

  it('keeps a tag that was made after it at the end', async () => {
    const { db, two } = await three()
    await moveTag(db, two.id, -1)
    await createTag(db, 'Four')
    expect(await names(db)).toEqual(['Two', 'One', 'Three', 'Four'])
  })
})

describe('how many messages have each tag', () => {
  it('counts the messages with a keyword, in any case, and leaves out what has none', async () => {
    const { db } = await migratedDatabase()
    const added = await addAccount(
      db,
      {
        displayName: 'Work',
        emailAddress: 'work@example.org',
        imapHost: 'imap.example.org',
        imapPort: 993,
        imapSecure: 'tls',
        imapUsername: 'work',
        smtpHost: null,
        smtpPort: null,
        smtpSecure: null,
        smtpUsername: null,
        password: 'secret',
        smtpPassword: null
      },
      { now: 1 }
    )
    const [inbox] = await syncFolders(db, added.id, [{ path: 'INBOX', name: 'INBOX', parentPath: null, flags: [], specialUse: '\Inbox' }])
    const fetched = (uid: number, flags: string[]): FetchedMessage => ({
      uid,
      flags,
      size: 1,
      hasAttachment: false,
      envelope: { subject: 's', date: new Date(2026, 9, 1), from: [{ address: 'x@sender.test' }] }
    })
    await saveMessages(db, inbox, [fetched(1, ['Work', '\Seen']), fetched(2, ['work']), fetched(3, ['Other']), fetched(4, [])])
    expect(await tagCounts(db)).toMatchObject({ work: 2, other: 1 })
    expect((await tagCounts(db)).missing).toBeUndefined()
  })
})
