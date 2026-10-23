import { keywordFor } from '@peregrine/core/tags'
import type { Tag } from './tags'

/** What is asked for by tag in a search, and what is left of it for the rest of the syntax. */
export interface TagTerms {
  /** The names or keywords that were written after `tag:`, one for each. */
  asked: string[]
  /** The search without them. */
  rest: string
}

/** `tag:Name` or `tag:"Name with spaces"`, at the start or after a space. */
const TAG_TERM = /(^|\s)tag:(?:"([^"]*)"|(\S+))/gi

/**
 * Takes the `tag:` terms out of a search. The syntax that the desktop and the phone share does not have them, and
 * putting one in would make the desktop drop it without saying; so it is read here, before the shared parser sees the rest.
 * A `tag:` with nothing after it is left in, to be looked for as a word like any other.
 */
export function extractTagTerms(input: string): TagTerms {
  const asked: string[] = []
  const rest = input.replace(TAG_TERM, (whole, lead: string, quoted: string | undefined, bare: string | undefined) => {
    const name = (quoted ?? bare ?? '').trim()
    if (name === '') return whole
    asked.push(name)
    return lead
  })
  return { asked, rest: rest.trim() }
}

/**
 * The keyword a name written in a search stands for: the tag of that name, or of that keyword, as the user made them,
 * compared without regard to case. A name that is no tag of theirs is made a keyword the way a new tag's would be,
 * for a message may carry one that another client set, which is shown in grey.
 */
export function keywordAsked(name: string, tags: readonly Tag[]): string {
  const lower = name.toLowerCase()
  const found = tags.find((tag) => tag.name.toLowerCase() === lower) ?? tags.find((tag) => tag.keyword.toLowerCase() === lower)
  return found ? found.keyword : keywordFor(name)
}
