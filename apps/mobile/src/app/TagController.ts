import { createTag, listTags, type Tag } from '../tags'
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

  /** Makes a tag, which is in the store from then on, and returns it. A name that is nothing makes none. */
  async create(name: string, color?: string): Promise<Tag | undefined> {
    const made = await createTag(this.services.db, name, color)
    await this.load()
    return made
  }
}
