import { appError } from '@peregrine/core/errorText'
import type { SqlDb } from '../db/sqlDb'
import { dialog, type BrowserWindow, type IpcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import { IpcChannels } from '@shared/ipcContracts'
import type { MessageRef, MessageSourceResult } from '@peregrine/core/types'
import { getFolderById } from '../db/repositories/foldersRepo'
import { getMessageByUid, getMessageRawSource } from '../db/repositories/messagesRepo'
import { splitHeadersAndBody } from '../pgp/pgpMimeParser'
import type { AccountManager } from '../accounts/AccountManager'
import { asBuffer } from '../util/buffer'
import { withTimeout } from '../util/withTimeout'

const FETCH_TIMEOUT_MS = 20_000

/** Parses the header block into pairs, keeping order and repeats. */
function parseHeaders(block: string): { name: string; value: string }[] {
  // Unfold first: a long Received header is wrapped across lines, and each continuation
  // belongs to the header above it rather than being one of its own.
  const unfolded = block.replace(/\r?\n[ \t]+/g, ' ')
  const headers: { name: string; value: string }[] = []
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    headers.push({ name: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() })
  }
  return headers
}

/**
 * The message exactly as it arrived.
 *
 * Fetched fresh rather than reassembled from the parsed columns: the point of looking at the
 * source is to see what the server actually holds, and anything rebuilt here would show what
 * this app made of it instead.
 */
export function registerMessageSourceIpc(
  ipcMain: IpcMain,
  db: SqlDb,
  accountManager: AccountManager,
  getWindow: () => BrowserWindow | undefined
): void {
  async function loadSource(ref: MessageRef): Promise<string> {
    const message = await getMessageByUid(db, ref.folderId, ref.uid)
    // PGP messages already keep their source, so there is nothing to fetch.
    const stored = message ? await getMessageRawSource(db, message.id) : null
    if (stored) return stored

    const folder = await getFolderById(db, ref.folderId)
    const imap = accountManager.getImapConnection(ref.accountId)
    if (!folder || !imap) throw appError('messageUnavailable')

    const raw = await withTimeout(
      imap.fetchFullMessage(folder.imapPath, ref.uid),
      FETCH_TIMEOUT_MS,
      'Fetching message source'
    )
    if (!raw?.source) throw appError('sourceFetchFailed')
    return asBuffer(raw.source).toString('utf8')
  }

  ipcMain.handle(
    IpcChannels.messagesGetSource,
    async (_event, ref: MessageRef): Promise<MessageSourceResult> => {
      const source = await loadSource(ref)
      const { headers } = splitHeadersAndBody(source.replace(/\r?\n/g, '\r\n'))
      return { source, headers: parseHeaders(headers), sizeBytes: Buffer.byteLength(source) }
    }
  )

  ipcMain.handle(
    IpcChannels.messagesExportEml,
    async (
      _event,
      args: { ref: MessageRef; suggestedName: string }
    ): Promise<{ savedPath: string | null }> => {
      const source = await loadSource(args.ref)
      const window = getWindow()
      const result = await dialog.showSaveDialog(window as BrowserWindow, {
        defaultPath: args.suggestedName,
        filters: [{ name: 'E-Mail', extensions: ['eml'] }]
      })
      if (result.canceled || !result.filePath) return { savedPath: null }
      await writeFile(result.filePath, source, 'utf8')
      return { savedPath: result.filePath }
    }
  )
}
