import { appError } from '@peregrine/core/errorText'
import type { SqlDb } from '../db/sqlDb'
import type { IpcMain } from 'electron'
import { IpcChannels } from '@shared/ipcContracts'
import type { FolderNode } from '@peregrine/core/types'
import { listAccounts } from '../db/repositories/accountsRepo'
import {
  deleteFolder,
  getFolderById,
  getFolderBySpecialUse,
  listAllFolders,
  listFolders,
  renameFolder,
  upsertFolder
} from '../db/repositories/foldersRepo'
import {
  deleteMessages,
  listFolderUids,
  listUnreadUids,
  markFolderRead
} from '../db/repositories/messagesRepo'
import type { AccountManager } from '../accounts/AccountManager'
import { syncStats } from '../imap/syncEngine'

export function registerFoldersIpc(ipcMain: IpcMain, db: SqlDb, accountManager: AccountManager): void {
  ipcMain.handle(
    IpcChannels.foldersList,
    async (_event, { accountId }: { accountId: string }): Promise<FolderNode[]> => {
      await accountManager.ensureFoldersSynced(accountId)
      return listFolders(db, accountId)
    }
  )

  // The sidebar shows every mailbox at once, so it needs one call that covers all accounts.
  // Folder syncs run concurrently; a single unreachable account must not stall the others.
  ipcMain.handle(IpcChannels.foldersListAll, async (): Promise<FolderNode[]> => {
    await Promise.all(
      (await listAccounts(db)).map(async (account) => {
        try {
          await accountManager.ensureFoldersSynced(account.id)
        } catch (err) {
          console.error('folder sync failed:', err instanceof Error ? err.message : err)
        }
      })
    )
    return listAllFolders(db)
  })

  ipcMain.handle(
    IpcChannels.foldersCreate,
    async (
      _event,
      args: { accountId: string; parentFolderId: string | null; name: string }
    ): Promise<{ folderId: string }> => {
      const imap = accountManager.getImapConnection(args.accountId)
      if (!imap) throw appError('notConnected')

      const parent = args.parentFolderId ? await getFolderById(db, args.parentFolderId) : undefined
      const delimiter = await imap.pathDelimiter()
      const imapPath = parent ? `${parent.imapPath}${delimiter}${args.name}` : args.name

      await imap.createMailbox(imapPath)
      const folderId = await upsertFolder(db, {
        accountId: args.accountId,
        imapPath,
        displayName: args.name,
        specialUse: null,
        parentId: parent?.id ?? null
      })
      return { folderId }
    }
  )

  ipcMain.handle(
    IpcChannels.foldersRename,
    async (_event, args: { folderId: string; name: string }): Promise<void> => {
      const folder = await getFolderById(db, args.folderId)
      const imap = folder ? accountManager.getImapConnection(folder.accountId) : undefined
      if (!folder || !imap) throw appError('folderUnavailable')
      // Special-use folders carry meaning for sync and for every "archive"/"trash" action.
      if (folder.specialUse !== null) throw appError('specialFolderRename')

      const delimiter = await imap.pathDelimiter()
      const segments = folder.imapPath.split(delimiter)
      segments[segments.length - 1] = args.name
      const newPath = segments.join(delimiter)

      await imap.renameMailbox(folder.imapPath, newPath)
      await renameFolder(db, folder.id, args.name, newPath)
    }
  )

  ipcMain.handle(
    IpcChannels.foldersDelete,
    async (_event, args: { folderId: string }): Promise<void> => {
      const folder = await getFolderById(db, args.folderId)
      const imap = folder ? accountManager.getImapConnection(folder.accountId) : undefined
      if (!folder || !imap) throw appError('folderUnavailable')
      if (folder.specialUse !== null) throw appError('specialFolderDelete')

      await imap.deleteMailbox(folder.imapPath)
      await deleteFolder(db, folder.id)
    }
  )

  ipcMain.handle(
    IpcChannels.foldersMarkAllRead,
    async (_event, args: { folderId: string }): Promise<{ count: number }> => {
      const folder = await getFolderById(db, args.folderId)
      const imap = folder ? accountManager.getImapConnection(folder.accountId) : undefined
      if (!folder || !imap) throw appError('folderUnavailable')

      const unread = await listUnreadUids(db, folder.id)
      for (const uid of unread) {
        await imap.setFlags(folder.imapPath, uid, ['\\Seen'])
      }
      await markFolderRead(db, folder.id)
      return { count: unread.length }
    }
  )

  ipcMain.handle(
    IpcChannels.foldersEmptyTrash,
    async (_event, args: { accountId: string }): Promise<{ count: number }> => {
      const trash = await getFolderBySpecialUse(db, args.accountId, 'trash')
      const imap = accountManager.getImapConnection(args.accountId)
      if (!trash || !imap) throw appError('trashUnavailable')

      const count = await imap.purgeMailbox(trash.imapPath)
      await deleteMessages(db, trash.id, await listFolderUids(db, trash.id))
      return { count }
    }
  )

  // Same code path as the periodic background refresh, so a manual "fetch all" reports
  // progress the same way and cannot run alongside a scheduled round on the same connection.
  ipcMain.handle(IpcChannels.syncAll, async (): Promise<{ syncedFolders: number }> => {
    syncStats.skipped = 0
    syncStats.fetched = 0
    const syncedFolders = await accountManager.syncAllAccounts()
    console.log(`[sync] ${syncStats.skipped} Ordner uebersprungen, ${syncStats.fetched} abgerufen`)
    return { syncedFolders }
  })
}
