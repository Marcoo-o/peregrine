import { createTag, deleteTag, listTags, moveTag, tagCounts, updateTag, type Tag } from '../tags'
import type { Services } from './services'
import type { AppStore } from './store'

/** The tags the user has made: read into the store for the lists to show, and added to by the sheet that sets them. */
export class TagController {
  constructor(
    private readonly services: Services,
    private readonly store: AppStore
  ) {}

  /** Reads the tags from the database into the store. */
  async load(): Promise<void> {
    this.store.setTags(await listTags(this.services.db))
  }

  /** Shows the tags, with how many messages have each, to be renamed, recoloured, moved or forgotten, and made. */
  async show(): Promise<void> {
    this.store.showScreen({ name: 'tags', counts: await tagCounts(this.services.db) })
  }

  /** Renames a tag or recolours it, and says whether it did: a name that is nothing is no name. */
  async update(id: string, name: string, color: string): Promise<boolean> {
    const changed = await updateTag(this.services.db, id, name, color)
    await this.load()
    return changed
  }

  /** Moves a tag one place up or down among the others, and says whether it moved. */
  async move(id: string, by: -1 | 1): Promise<boolean> {
    const moved = await moveTag(this.services.db, id, by)
    await this.load()
    return moved
  }

  /** Forgets a tag. The messages keep its keyword. */
  async remove(id: string): Promise<void> {
    await deleteTag(this.services.db, id)
    await this.load()
  }

  /** Makes a tag, which is in the store from then on, and returns it. A name that is nothing makes none. */
  async create(name: string, color?: string): Promise<Tag | undefined> {
    const made = await createTag(this.services.db, name, color)
    await this.load()
    return made
  }
}
