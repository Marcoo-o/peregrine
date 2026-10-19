import { describe, expect, it } from 'vitest'
import { fuzzyMatch, rankItems } from './fuzzy'

describe('fuzzyMatch', () => {
  it('matches an exact substring', () => {
    expect(fuzzyMatch('archiv', 'Archivieren').score).toBeGreaterThan(0)
  })

  // The point of a palette: type the shape of what you want, not its exact wording.
  it('matches scattered initials', () => {
    expect(fuzzyMatch('vnn', 'Verfassen neue Nachricht').score).toBeGreaterThan(0)
  })

  it('rejects letters that are not there', () => {
    expect(fuzzyMatch('xyz', 'Archivieren').score).toBeLessThan(0)
  })

  it('rejects letters in the wrong order', () => {
    expect(fuzzyMatch('nra', 'Archiv').score).toBeLessThan(0)
  })

  it('ignores case', () => {
    expect(fuzzyMatch('ARCH', 'archivieren').score).toBeGreaterThan(0)
  })

  it('treats an empty query as matching everything', () => {
    expect(fuzzyMatch('', 'irgendwas').score).toBe(0)
  })

  it('reports where it matched, for highlighting', () => {
    expect(fuzzyMatch('ab', 'axb').positions).toEqual([0, 2])
  })

  it('ignores spaces in the query', () => {
    expect(fuzzyMatch('a b', 'axb').score).toBeGreaterThan(0)
  })
})

describe('rankItems', () => {
  const commands = ['Archivieren', 'Alle Ordner abrufen', 'Als ungelesen markieren']

  it('puts a consecutive match first', () => {
    const ranked = rankItems('archi', commands, (c) => c)
    expect(ranked[0].item).toBe('Archivieren')
  })

  it('prefers word starts over letters found mid-word', () => {
    const ranked = rankItems('aoa', commands, (c) => c)
    expect(ranked[0].item).toBe('Alle Ordner abrufen')
  })

  it('drops what does not match', () => {
    expect(rankItems('zzz', commands, (c) => c)).toEqual([])
  })

  it('returns everything for an empty query', () => {
    expect(rankItems('', commands, (c) => c)).toHaveLength(3)
  })
})
