import { getAccount } from '../accounts'
import { describeError } from '../errors'
import { FLAGGED, SEEN } from '../flags'
import { getFolder, getFolderBySpecialUse, type Folder } from '../folders'
import { listMessages } from '../messages'
import type { Navigator } from './Navigator'
import { groupByFolder, type Picked } from './selection'
import type { Services } from './services'
import type { AppStore } from './store'

/**
 * Doing one thing to several messages chosen in a list. What is chosen is grouped by folder, since the queue
 * works on the messages of one folder at a time, and the list is shown again when it is done, where the effect
 * of it is to be seen. Everything goes through the actions of the queue, as for one message.
 */
export class SelectionController {
  constructor(
    private readonly services: Services,
    private readonly store: AppStore,
    private readonly navigator: Navigator
  ) {}

  /** Marks the messages read, or unread. */
  async markRead(picked: Picked[], read: boolean): Promise<void> {
    await this.eachFolder(picked, (folder, uids) =>
      this.services.mail.setFlags(folder, uids, read ? [SEEN] : [], read ? [] : [SEEN])
    )
  }

  /**
   * Stars the messages, or takes the star off when all of them have one. One tap on a choice that is mixed
   * stars the rest, and does not unstar what is starred.
   */
  async toggleStar(picked: Picked[]): Promise<void> {
    const allStarred = await this.allStarred(picked)
    await this.eachFolder(picked, (folder, uids) =>
      this.services.mail.setFlags(folder, uids, allStarred ? [] : [FLAGGED], allStarred ? [FLAGGED] : [])
    )
  }

  /** Sets a tag on the messages, or takes it off them: a tag is a keyword like any other flag, and goes the way flags go. */
  async setTag(picked: Picked[], keyword: string, on: boolean): Promise<void> {
    await this.eachFolder(picked, (folder, uids) =>
      this.services.mail.setFlags(folder, uids, on ? [keyword] : [], on ? [] : [keyword])
    )
  }

  /** Puts the messages into the archive of their accounts. Returns what is to be said when an account has none. */
  archive(picked: Picked[]): Promise<string | undefined> {
    return this.moveToRole(picked, '\\Archive', 'Archivordner')
  }

  /** Puts the messages into the spam folder of their accounts. Returns what is to be said when an account has none. */
  markAsJunk(picked: Picked[]): Promise<string | undefined> {
    return this.moveToRole(picked, '\\Junk', 'Spam-Ordner')
  }

  /** Deletes the messages, into the trash of their accounts. */
  async remove(picked: Picked[]): Promise<void> {
    await this.eachFolder(picked, (folder, uids) => this.services.mail.remove(folder, uids))
  }

  private async moveToRole(picked: Picked[], role: string, name: string): Promise<string | undefined> {
    const without = new Set<string>()
    await this.eachFolder(picked, async (folder, uids) => {
      const target = await getFolderBySpecialUse(this.services.db, folder.accountId, role)
      if (!target) {
        const account = await getAccount(this.services.db, folder.accountId)
        without.add(account?.emailAddress || account?.displayName || folder.accountId)
        return
      }
      await this.services.mail.move(folder, uids, target)
    })
    return without.size > 0 ? `Für ${[...without].join(', ')} ist kein ${name} vorhanden` : undefined
  }

  private async allStarred(picked: Picked[]): Promise<boolean> {
    for (const group of groupByFolder(picked)) {
      const messages = await listMessages(this.services.db, group.folderId)
      for (const uid of group.uids) {
        const message = messages.find((candidate) => candidate.uid === uid)
        if (message && !message.flags.includes(FLAGGED)) return false
      }
    }
    return picked.length > 0
  }

  /**
   * Runs an action on the chosen messages of each folder, and shows the list again. A folder that is gone is
   * skipped, and an action that fails does not keep the others from running: it is logged.
   */
  private async eachFolder(picked: Picked[], action: (folder: Folder, uids: number[]) => Promise<void>): Promise<void> {
    for (const group of groupByFolder(picked)) {
      const folder = await getFolder(this.services.db, group.folderId)
      if (!folder) continue
      try {
        await action(folder, group.uids)
      } catch (error) {
        this.services.log.error(describeError(error))
      }
    }
    await this.showListAgain()
  }

  /** The list the choice was made in, as it is now. It is read from the database and nobody waits for the server. */
  private async showListAgain(): Promise<void> {
    const screen = this.store.screen
    if (screen.name === 'messages') await this.navigator.showMessages(screen.account, screen.folder, { sync: false })
    else if (screen.name === 'unified') await this.navigator.showUnified({ refresh: false })
  }
}
