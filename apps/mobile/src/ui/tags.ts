import { createContext, useContext } from 'react'
import type { Tag } from '../tags'

/** The tags the user has made, for every list and message that shows the tags of a message. */
export const TagsContext = createContext<Tag[]>([])

export const useTags = (): Tag[] => useContext(TagsContext)
