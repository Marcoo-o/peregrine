import { appError } from '@peregrine/core/errorText'
import type { SqlDb } from '../db/sqlDb'
import { copyFile, open } from 'node:fs/promises'
import { basename } from 'node:path'
import { dialog, shell, type BrowserWindow, type IpcMain } from 'electron'
import { IpcChannels } from '@shared/ipcContracts'
import { SNIFF_BYTES } from '@peregrine/core/fileType'
import { refusalForOpening } from '@peregrine/core/attachmentSafety'
import { attachmentCacheSize, clearAttachmentCache } from '../attachments/cache'
import {
  clearAttachmentLocalPaths,
  getAttachmentLocalPath
} from '../db/repositories/attachmentsRepo'

/**
 * The cached file behind one attachment.
 *
 * By the row's own id, and the message is asked for as well so a caller cannot reach an
 * attachment of some other message by holding its id alone.
 *
 * It used to look up `part_id`, which the window rebuilt from the message as
 * `contentId ?? filename ?? 'part'`. Nothing made that unique. Two attachments called
 * `invoice.pdf`, or two parts carrying neither a name nor a content id, both matched the same
 * row, and `.get()` answered with the first one. Opening the second attachment then handed
 * over the first one's bytes, under the second one's name.
 */
async function localPathOf(db: SqlDb, messageId: string, attachmentId: string): Promise<string> {
  const path = await getAttachmentLocalPath(db, messageId, attachmentId)
  if (!path) throw appError('attachmentNotDownloaded')
  return path
}

export function registerAttachmentsIpc(
  ipcMain: IpcMain,
  db: SqlDb,
  getWindow: () => BrowserWindow | undefined
): void {
  ipcMain.handle(IpcChannels.attachmentsPickFiles, async (): Promise<{ filePaths: string[] }> => {
    const win = getWindow()
    if (!win) return { filePaths: [] }
    const result = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] })
    return { filePaths: result.canceled ? [] : result.filePaths }
  })

  // There was a second save here that took the destination path straight from the window and
  // copied to it, with no dialog and no check that the path was anywhere sensible. Nothing
  // called it. It has been removed rather than repaired, because a channel that writes to any
  // path the caller names is worth having only if something actually needs it, and saving goes
  // through the dialog below.

  ipcMain.handle(
    IpcChannels.attachmentsSaveAs,
    async (
      _event,
      args: { messageId: string; attachmentId: string; suggestedName: string }
    ): Promise<{ savedPath: string | null }> => {
      const win = getWindow()
      if (!win) return { savedPath: null }
      const source = await localPathOf(db, args.messageId, args.attachmentId)
      const result = await dialog.showSaveDialog(win, { defaultPath: args.suggestedName })
      if (result.canceled || !result.filePath) return { savedPath: null }
      await copyFile(source, result.filePath)
      return { savedPath: result.filePath }
    }
  )

  ipcMain.handle(IpcChannels.attachmentsCacheInfo, async (): Promise<{ sizeBytes: number }> => ({
    sizeBytes: await attachmentCacheSize()
  }))

  ipcMain.handle(IpcChannels.attachmentsClearCache, async (): Promise<void> => {
    await clearAttachmentCache()
    await clearAttachmentLocalPaths(db)
  })

  /**
   * Hands a file to whatever the system opens it with.
   *
   * Two questions, because neither one alone is enough.
   *
   * The name decides what the shell starts. `shell.openPath` looks the extension up and runs
   * whatever is registered for it, so a `.bat`, a `.vbs` or a `.url` executes no matter what is
   * inside it. Reading the bytes cannot help here: a script is plain text and has no signature,
   * so a check built only on signatures answers "unknown" and lets every one of them through.
   * That was the hole. The extension is therefore refused on its own.
   *
   * The content decides whether the name was honest. A compiled program named `invoice.pdf`
   * passes the extension check and is exactly the shape a delivered program takes, so the first
   * bytes are read and a file that disagrees with its own name is refused as well.
   *
   * Both checks sit here rather than in the window, because the window is where the judgement
   * used to be made and anything reaching this channel could have the file opened regardless.
   * Nothing legitimate needs Peregrine to launch a program straight out of a message. Saving it
   * first leaves that decision with the person, where it belongs.
   */
  ipcMain.handle(
    IpcChannels.attachmentsOpen,
    async (
      _event,
      args: { messageId: string; attachmentId: string }
    ): Promise<{ opened: boolean; refused?: 'executable' | 'mismatch' }> => {
      const path = await localPathOf(db, args.messageId, args.attachmentId)

      const handle = await open(path, 'r')
      let head: Uint8Array
      try {
        const buffer = Buffer.alloc(SNIFF_BYTES)
        const { bytesRead } = await handle.read(buffer, 0, SNIFF_BYTES, 0)
        head = new Uint8Array(buffer.subarray(0, bytesRead))
      } finally {
        await handle.close()
      }

      // The rule is shared with the phone, so that the same file is refused on both.
      const refused = refusalForOpening(basename(path), head)
      if (refused) return { opened: false, refused }

      // openPath returns a non-empty string on failure (e.g. no handler registered).
      const error = await shell.openPath(path)
      return { opened: error === '' }
    }
  )
}
