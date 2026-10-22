import type { SqlDb } from '@peregrine/core/sqlDb'
import { listAccounts, type Account } from './accounts'
import { listFolders, type Folder } from './folders'
import { unreadCounts } from './messages'
import { unifiedUnread, type UnifiedRole } from './unified'

/** One account of the sidebar: its folders, and how many messages of each are not read. */
export interface SidebarAccount {
  account: Account
  folders: Folder[]
  unread: Record<string, number>
}

/**
 * What the sidebar is made of, as the desktop's is: the folders that are one for all accounts with how many
 * messages of each are not read, and then every account with its own. It is read from the database, so it is
 * there without a connection, and it is read again whenever it is opened.
 */
export interface SidebarData {
  unified: Record<UnifiedRole, number>
  accounts: SidebarAccount[]
}

export async function loadSidebar(db: SqlDb): Promise<SidebarData> {
  const accounts = await listAccounts(db)
  return {
    unified: await unifiedUnread(db),
    accounts: await Promise.all(
      accounts.map(async (account) => ({
        account,
        folders: await listFolders(db, account.id),
        unread: await unreadCounts(db, account.id)
      }))
    )
  }
}
