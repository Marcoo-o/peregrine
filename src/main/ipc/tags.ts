import type { SqlDb } from '../db/sqlDb'
import type { IpcMain } from 'electron'
import { IpcChannels } from '@shared/ipcContracts'
import type { MessageRef, Tag } from '@peregrine/core/types'
import { createTag, deleteTag, getTag, listTags, updateTag } from '../db/repositories/tagsRepo'
import { getFolderById } from '../db/repositories/foldersRepo'
import { setMessageKeyword } from '../db/repositories/messagesRepo'
import type { AccountManager } from '../accounts/AccountManager'

/**
 * Tags are set on the server, not locally.
 *
 * Every change goes out as an IMAP flag first; the local row is only updated afterwards, from
 * what the server accepted. A tag that exists only here would disappear on the next sync and
 * look like the app had lost it.
 */
export function registerTagsIpc(
  ipcMain: IpcMain,
  db: SqlDb,
  accountManager: AccountManager
): void {
  ipcMain.handle(IpcChannels.tagsList, (): Promise<Tag[]> => listTags(db))

  ipcMain.handle(
    IpcChannels.tagsCreate,
    async (_event, args: { name: string; color: string }): Promise<{ tagId: string }> => ({
      tagId: await createTag(db, args.name, args.color)
    })
  )

  ipcMain.handle(
    IpcChannels.tagsUpdate,
    async (_event, args: { tagId: string; name: string; color: string }): Promise<void> => {
      await updateTag(db, args.tagId, args.name, args.color)
    }
  )

  /**
   * Removing a tag leaves the keyword on the messages that carry it.
   *
   * Stripping it from every message would mean touching mail this app may not have synced,
   * and the same keyword may be in use by another client under its own name. Forgetting the
   * definition is reversible; rewriting a mailbox is not.
   */
  ipcMain.handle(IpcChannels.tagsDelete, async (_event, args: { tagId: string }): Promise<void> => {
    await deleteTag(db, args.tagId)
  })

  ipcMain.handle(
    IpcChannels.messagesSetTag,
    async (
      _event,
      args: { refs: MessageRef[]; tagId: string; apply: boolean }
    ): Promise<{ changed: number }> => {
      const tag = await getTag(db, args.tagId)
      if (!tag) return { changed: 0 }

      let changed = 0

      for (const ref of args.refs) {
        const folder = await getFolderById(db, ref.folderId)
        const imap = accountManager.getImapConnection(ref.accountId)
        if (!folder || !imap) continue

        try {
          if (args.apply) await imap.addFlags(folder.imapPath, ref.uid, [tag.keyword])
          else await imap.removeFlags(folder.imapPath, ref.uid, [tag.keyword])
        } catch (err) {
          // A server that refuses custom keywords is a real possibility; skipping the local
          // update keeps the two in step rather than showing a tag that is not really there.
          console.error('setting tag failed:', err instanceof Error ? err.message : err)
          continue
        }

        await setMessageKeyword(db, ref.folderId, ref.uid, tag.keyword, args.apply)
        changed += 1
      }

      return { changed }
    }
  )
}
