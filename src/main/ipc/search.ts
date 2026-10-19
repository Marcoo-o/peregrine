import type { SqlDb } from '../db/sqlDb'
import type { IpcMain } from 'electron'
import { IpcChannels } from '@shared/ipcContracts'
import type { SearchResultItem } from '@peregrine/core/types'
import { searchMessages } from '../db/repositories/messagesRepo'

export function registerSearchIpc(ipcMain: IpcMain, db: SqlDb): void {
  ipcMain.handle(
    IpcChannels.searchMessages,
    (
      _event,
      args: { accountIds?: string[]; query: string; limit: number }
    ): Promise<SearchResultItem[]> => {
      return searchMessages(db, args.accountIds, args.query, args.limit)
    }
  )
}
