import { describe, expect, it } from 'vitest'
import { extractTagTerms, keywordAsked } from './searchTags'
import type { Tag } from './tags'

const tag = (name: string, keyword: string): Tag => ({ id: keyword, name, keyword, color: '#000000', sortOrder: 0 })

describe('the tags asked for in a search', () => {
  it('are taken out, by name, with what is left for the rest of the syntax', () => {
    expect(extractTagTerms('tag:Rechnungen von:anna budget')).toEqual({ asked: ['Rechnungen'], rest: 'von:anna budget' })
    expect(extractTagTerms('budget tag:Rechnungen')).toEqual({ asked: ['Rechnungen'], rest: 'budget' })
  })

  it('may have quotes for a name with spaces, and be several', () => {
    expect(extractTagTerms('tag:"Für später" tag:Wichtig x')).toEqual({ asked: ['Für später', 'Wichtig'], rest: 'x' })
  })

  it('are not found in the middle of a word, and in any case of the letters of tag', () => {
    expect(extractTagTerms('stag:x')).toEqual({ asked: [], rest: 'stag:x' })
    expect(extractTagTerms('TAG:x')).toEqual({ asked: ['x'], rest: '' })
  })

  it('leave a tag: with nothing after it where it was', () => {
    expect(extractTagTerms('tag: budget')).toEqual({ asked: [], rest: 'tag: budget' })
    expect(extractTagTerms('tag:"" budget')).toEqual({ asked: [], rest: 'tag:"" budget' })
  })
})

describe('the keyword a name in a search stands for', () => {
  const tags = [tag('Für später', 'Fuer_spaeter'), tag('Rechnungen', 'Rechnungen')]

  it('is that of the tag with that name, in any case', () => {
    expect(keywordAsked('für SPÄTER', tags)).toBe('Fuer_spaeter')
  })

  it('is that of the tag with that keyword, which is how another client shows it', () => {
    expect(keywordAsked('fuer_spaeter', tags)).toBe('Fuer_spaeter')
  })

  it('is made of the name as a new tag would be, when it is no tag of the user', () => {
    expect(keywordAsked('Mein Tag', tags)).toBe('Mein_Tag')
  })
})
