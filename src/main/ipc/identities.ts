import type { SqlDb } from '../db/sqlDb'
import type { IpcMain } from 'electron'
import { IpcChannels } from '@shared/ipcContracts'
import type { Identity, IdentityInput } from '@peregrine/core/types'
import {
  createIdentity,
  deleteIdentity,
  listIdentities,
  setDefaultIdentity,
  updateIdentity
} from '../db/repositories/identitiesRepo'

export function registerIdentitiesIpc(ipcMain: IpcMain, db: SqlDb): void {
  ipcMain.handle(
    IpcChannels.identitiesList,
    (_event, { accountId }: { accountId?: string }): Promise<Identity[]> =>
      listIdentities(db, accountId)
  )

  ipcMain.handle(
    IpcChannels.identitiesCreate,
    async (_event, input: IdentityInput): Promise<{ identityId: string }> => ({
      identityId: await createIdentity(db, input)
    })
  )

  ipcMain.handle(
    IpcChannels.identitiesUpdate,
    async (_event, args: { identityId: string } & Partial<IdentityInput>): Promise<void> => {
      const { identityId, ...fields } = args
      await updateIdentity(db, identityId, fields)
    }
  )

  ipcMain.handle(
    IpcChannels.identitiesDelete,
    async (_event, { identityId }: { identityId: string }): Promise<{ removed: boolean }> => ({
      removed: await deleteIdentity(db, identityId)
    })
  )

  ipcMain.handle(
    IpcChannels.identitiesSetDefault,
    (_event, { identityId }: { identityId: string }): Promise<void> =>
      setDefaultIdentity(db, identityId)
  )
}
