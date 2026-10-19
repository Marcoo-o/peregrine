/**
 * Ranking for the command palette.
 *
 * Subsequence matching rather than substring: typing "vnf" should find "Verfassen neue
 * Nachricht", which is the whole point of a palette. You type the shape of what you want,
 * not its exact wording.
 */

export interface FuzzyMatch {
  /** Higher is better; below zero means no match at all. */
  score: number
  /** Indices of the matched characters, for highlighting. */
  positions: number[]
}

const NO_MATCH: FuzzyMatch = { score: -1, positions: [] }

export function fuzzyMatch(query: string, text: string): FuzzyMatch {
  if (query === '') return { score: 0, positions: [] }

  const needle = query.toLowerCase()
  const haystack = text.toLowerCase()

  let score = 0
  let textIndex = 0
  const positions: number[] = []

  for (const char of needle) {
    // Spaces in the query only separate; they need not appear in the text.
    if (char === ' ') continue
    const found = haystack.indexOf(char, textIndex)
    if (found === -1) return NO_MATCH

    // A character right after the previous one, or at the start of a word, is a better
    // signal than one found somewhere far along. That is what makes "vnf" beat a stray
    // scattering of the same letters.
    if (found === textIndex && positions.length > 0) score += 8
    else if (found === 0 || /[\s\-_/(]/.test(haystack[found - 1] ?? '')) score += 6
    else score += 1

    positions.push(found)
    textIndex = found + 1
  }

  // Shorter labels win when the match is otherwise equal: an exact short command should not
  // rank below a long one that merely contains the same letters.
  return { score: score - haystack.length * 0.05, positions }
}

export interface RankedItem<T> {
  item: T
  match: FuzzyMatch
}

export function rankItems<T>(query: string, items: T[], label: (item: T) => string): RankedItem<T>[] {
  return items
    .map((item) => ({ item, match: fuzzyMatch(query, label(item)) }))
    .filter((entry) => entry.match.score >= 0)
    .sort((a, b) => b.match.score - a.match.score)
}
