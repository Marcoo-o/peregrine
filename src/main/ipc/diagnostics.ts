import { dialog, type BrowserWindow, type IpcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import { IpcChannels } from '@shared/ipcContracts'
import type { ProtocolLogState } from '@peregrine/core/types'
import { protocolLog } from '../diagnostics/protocolLog'

function state(): ProtocolLogState {
  return {
    recording: protocolLog.isRecording(),
    verbose: protocolLog.isVerbose(),
    entries: protocolLog.list()
  }
}

/** One line per entry, in the order they happened. Readable in any text editor. */
function toText(): string {
  return protocolLog
    .list()
    .map(
      (entry) =>
        `${new Date(entry.at).toISOString()}  +${String(entry.deltaMs).padStart(6)}ms  ` +
        `${entry.connection}  ${entry.source.padEnd(6)}  ${entry.text}`
    )
    .join('\r\n')
}

export function registerDiagnosticsIpc(
  ipcMain: IpcMain,
  getWindow: () => BrowserWindow | null | undefined
): void {
  ipcMain.handle(IpcChannels.diagnosticsGet, (): ProtocolLogState => state())

  ipcMain.handle(
    IpcChannels.diagnosticsSetRecording,
    (_event, args: { recording: boolean }): ProtocolLogState => {
      protocolLog.setRecording(args.recording)
      return state()
    }
  )

  ipcMain.handle(
    IpcChannels.diagnosticsSetVerbose,
    (_event, args: { verbose: boolean }): ProtocolLogState => {
      protocolLog.setVerbose(args.verbose)
      return state()
    }
  )

  ipcMain.handle(IpcChannels.diagnosticsClear, (): ProtocolLogState => {
    protocolLog.clear()
    return state()
  })

  ipcMain.handle(IpcChannels.diagnosticsExport, async (): Promise<{ savedPath: string | null }> => {
    const window = getWindow()
    const result = await dialog.showSaveDialog(window as BrowserWindow, {
      defaultPath: `peregrine-verbindung-${new Date().toISOString().slice(0, 10)}.txt`,
      filters: [{ name: 'Text', extensions: ['txt'] }]
    })
    if (result.canceled || !result.filePath) return { savedPath: null }
    await writeFile(result.filePath, toText(), 'utf8')
    return { savedPath: result.filePath }
  })
}
