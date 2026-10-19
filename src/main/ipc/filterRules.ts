import { appError } from '@peregrine/core/errorText'
import type { SqlDb } from '../db/sqlDb'
import type { IpcMain } from 'electron'
import { IpcChannels } from '@shared/ipcContracts'
import type { FilterRule, FilterRuleInput } from '@peregrine/core/types'
import { importThunderbirdFilters, type FilterImportResult } from '../import/thunderbirdFilters'
import {
  createFilterRule,
  deleteFilterRule,
  listFilterRules,
  reorderFilterRules,
  setFilterRuleEnabled,
  updateFilterRule
} from '../db/repositories/filterRulesRepo'
import { getFolderById } from '../db/repositories/foldersRepo'
import { listFolderMessageRefs } from '../db/repositories/messagesRepo'
import { applyFilterRules } from '../filters/ruleEngine'
import type { AccountManager } from '../accounts/AccountManager'

export function registerFilterRulesIpc(
  ipcMain: IpcMain,
  db: SqlDb,
  accountManager: AccountManager
): void {
  ipcMain.handle(
    IpcChannels.filterRulesList,
    (_event, args: { accountId: string }): Promise<FilterRule[]> =>
      listFilterRules(db, args.accountId)
  )

  ipcMain.handle(
    IpcChannels.filterRulesCreate,
    async (_event, args: FilterRuleInput): Promise<{ ruleId: string }> => ({
      ruleId: await createFilterRule(db, args)
    })
  )

  ipcMain.handle(
    IpcChannels.filterRulesUpdate,
    async (_event, args: FilterRuleInput & { ruleId: string }): Promise<void> => {
      await updateFilterRule(db, args.ruleId, args)
    }
  )

  ipcMain.handle(
    IpcChannels.filterRulesDelete,
    async (_event, args: { ruleId: string }): Promise<void> => {
      await deleteFilterRule(db, args.ruleId)
    }
  )

  ipcMain.handle(
    IpcChannels.filterRulesSetEnabled,
    async (_event, args: { ruleId: string; enabled: boolean }): Promise<void> => {
      await setFilterRuleEnabled(db, args.ruleId, args.enabled)
    }
  )

  ipcMain.handle(
    IpcChannels.filterRulesReorder,
    async (_event, args: { accountId: string; ruleIds: string[] }): Promise<void> => {
      await reorderFilterRules(db, args.accountId, args.ruleIds)
    }
  )

  /**
   * Runs the rules over messages that are already in a folder. Filters otherwise only ever see
   * newly arriving mail, which makes a freshly written rule feel broken.
   */
  ipcMain.handle(
    IpcChannels.filterRulesApplyToFolder,
    async (
      _event,
      args: { accountId: string; folderId: string; ruleId?: string }
    ): Promise<{ matched: number }> => {
      const folder = await getFolderById(db, args.folderId)
      const imap = accountManager.getImapConnection(args.accountId)
      if (!folder || !imap) throw appError('folderUnavailable')

      const rows = await listFolderMessageRefs(db, args.folderId)

      const matched = await applyFilterRules(db, args.accountId, args.folderId, imap, rows, {
        onlyRuleId: args.ruleId
      })
      return { matched }
    }
  )

  ipcMain.handle(
    IpcChannels.filterRulesImportThunderbird,
    (_event, args: { accountId: string }): Promise<FilterImportResult | null> =>
      importThunderbirdFilters(db, args.accountId)
  )
}
