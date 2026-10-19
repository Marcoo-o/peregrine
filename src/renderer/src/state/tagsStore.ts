import { create } from 'zustand'
import type { Tag } from '@peregrine/core/types'

interface TagsState {
  tags: Tag[]
  load: () => Promise<void>
  /** Keyword → tag, for turning a message's flags into something displayable. */
  byKeyword: () => Map<string, Tag>
}

export const useTagsStore = create<TagsState>((set, get) => ({
  tags: [],
  load: async () => set({ tags: await window.peregrine.tags.list() }),
  byKeyword: () => new Map(get().tags.map((tag) => [tag.keyword, tag]))
}))
