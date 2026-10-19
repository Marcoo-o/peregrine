import type { SqlDb } from '../db/sqlDb'
import { app, type IpcMain } from 'electron'
import { IpcChannels } from '@shared/ipcContracts'
import type { AppSettings, AppVersionInfo } from '@peregrine/core/types'
import { getAppSettings, updateAppSettings } from '../db/repositories/appSettingsRepo'
import { applyWindowTheme } from '../windowTheme'

export function registerSettingsIpc(ipcMain: IpcMain, db: SqlDb): void {
  // Read rather than stored. `app.getVersion()` comes from the package.json of the running
  // build. Writing the number down somewhere would mean maintaining it in two places on every
  // release, and one of the two would eventually be wrong.
  ipcMain.handle(
    IpcChannels.appVersion,
    (): AppVersionInfo => ({
      version: app.getVersion(),
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      node: process.versions.node,
      packaged: app.isPackaged
    })
  )

  ipcMain.handle(IpcChannels.settingsGet, (): Promise<AppSettings> => getAppSettings(db))

  ipcMain.handle(
    IpcChannels.settingsUpdate,
    async (_event, patch: Partial<AppSettings>): Promise<AppSettings> => {
      const settings = await updateAppSettings(db, patch)
      // Windows paints the title bar, not the renderer. Without this line it would keep the old
      // theme until the application restarts.
      if (patch.theme !== undefined) applyWindowTheme(settings.theme)
      return settings
    }
  )
}
