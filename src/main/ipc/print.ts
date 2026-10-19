import { BrowserWindow, dialog, type IpcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import { IpcChannels } from '@shared/ipcContracts'

/**
 * Printing a message, and saving one as PDF.
 *
 * The page itself is built by the renderer, not here. It is the side that already runs the
 * message through DOMPurify before showing it, and printing must not become a second, more
 * trusting path to the same HTML. A message that cannot script the reading pane must not be
 * able to script a print window either.
 *
 * So the renderer hands over a finished `peregrine-mail://` URL, the same protocol the
 * reading pane uses, and this opens it in a window nobody ever sees.
 */

/** Long enough for images to arrive from the attachment cache, short enough not to hang. */
const RENDER_GRACE_MS = 700

// A4 at the 96 CSS-pixels-per-inch printing assumes. Without this the window falls back to
// Electron's default 800x600, a size that has nothing to do with the page it is printing, and
// leaves the shrink-to-fit that reconciles the two entirely up to whatever Chromium happens to
// do that version, which is how a message ended up printing noticeably larger after an
// unrelated Electron upgrade.
const PRINT_WINDOW_WIDTH = 794
const PRINT_WINDOW_HEIGHT = 1123

async function withPrintWindow<T>(
  url: string,
  run: (win: BrowserWindow) => Promise<T>
): Promise<T> {
  const win = new BrowserWindow({
    show: false,
    width: PRINT_WINDOW_WIDTH,
    height: PRINT_WINDOW_HEIGHT,
    webPreferences: {
      // No preload and no node: this window only ever shows one message. Everything it needs
      // is in the document it was handed.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      javascript: false
    }
  })
  try {
    await win.loadURL(url)
    await new Promise((resolve) => setTimeout(resolve, RENDER_GRACE_MS))
    return await run(win)
  } finally {
    win.destroy()
  }
}

export function registerPrintIpc(ipcMain: IpcMain, getWindow: () => BrowserWindow | undefined): void {
  ipcMain.handle(
    IpcChannels.printMessage,
    async (_event, args: { url: string }): Promise<{ printed: boolean }> =>
      withPrintWindow(args.url, async (win) => {
        return new Promise<{ printed: boolean }>((resolve) => {
          // `silent: false` opens the system print dialogue, which is where the user picks
          // the printer. Including "Microsoft Print to PDF" if they prefer that route.
          win.webContents.print({ silent: false, printBackground: true, pageSize: 'A4' }, (printed) =>
            resolve({ printed })
          )
        })
      })
  )

  ipcMain.handle(
    IpcChannels.printToPdf,
    async (
      _event,
      args: { url: string; suggestedName: string }
    ): Promise<{ savedPath: string | null }> => {
      const parent = getWindow()
      if (!parent) return { savedPath: null }

      // Asked before rendering: a save dialogue that appears after a pause reads as if the
      // application had stalled.
      const result = await dialog.showSaveDialog(parent, {
        defaultPath: args.suggestedName,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      })
      if (result.canceled || !result.filePath) return { savedPath: null }

      const pdf = await withPrintWindow(args.url, (win) =>
        win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
      )
      await writeFile(result.filePath, pdf)
      return { savedPath: result.filePath }
    }
  )
}
