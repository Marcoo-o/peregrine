import type { SqlDb } from '../db/sqlDb'
import { dialog, type BrowserWindow, type IpcMain } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { IpcChannels } from '@shared/ipcContracts'
import type { Contact } from '@peregrine/core/types'
import { parseVCards, serializeVCards } from '@peregrine/core/vcard'
import { findThunderbirdProfile } from '../import/thunderbird'
import { readThunderbirdAddressBooks } from '../import/thunderbirdAddressBook'
import {
  createContact,
  deleteContact,
  importContacts,
  listAllContacts,
  listContacts
} from '../db/repositories/contactsRepo'

export function registerContactsIpc(
  ipcMain: IpcMain,
  db: SqlDb,
  getWindow: () => BrowserWindow | undefined | null
): void {
  ipcMain.handle(
    IpcChannels.contactsList,
    (_event, args: { query?: string }): Promise<Contact[]> => listContacts(db, args.query)
  )

  ipcMain.handle(
    IpcChannels.contactsCreate,
    async (_event, args: { name: string; email: string }): Promise<{ contactId: string }> => ({
      contactId: await createContact(db, args.name, args.email)
    })
  )

  ipcMain.handle(
    IpcChannels.contactsDelete,
    async (_event, args: { contactId: string }): Promise<void> => {
      await deleteContact(db, args.contactId)
    }
  )

  ipcMain.handle(
    IpcChannels.contactsImportVCard,
    async (): Promise<{ added: number; updated: number; skipped: number } | null> => {
      const win = getWindow()
      if (!win) return null
      const result = await dialog.showOpenDialog(win, {
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'vCard', extensions: ['vcf', 'vcard'] },
          { name: 'All files', extensions: ['*'] }
        ]
      })
      if (result.canceled || result.filePaths.length === 0) return null

      const totals = { added: 0, updated: 0, skipped: 0 }
      for (const path of result.filePaths) {
        // Read as UTF-8 regardless of what the file claims. Address books written on older
        // systems carry a CHARSET parameter naming something else, but every exporter still
        // in use writes UTF-8, and guessing wrong garbles names rather than failing loudly.
        const entries = parseVCards(await readFile(path, 'utf8'))
        const counts = await importContacts(db, entries)
        totals.added += counts.added
        totals.updated += counts.updated
        totals.skipped += counts.skipped
      }
      return totals
    }
  )

  ipcMain.handle(
    IpcChannels.contactsExportVCard,
    async (): Promise<{ savedPath: string; count: number } | null> => {
      const win = getWindow()
      if (!win) return null
      const result = await dialog.showSaveDialog(win, {
        defaultPath: 'peregrine-contacts.vcf',
        filters: [{ name: 'vCard', extensions: ['vcf'] }]
      })
      if (result.canceled || !result.filePath) return null

      const contacts = await listAllContacts(db)
      await writeFile(result.filePath, serializeVCards(contacts), 'utf8')
      return { savedPath: result.filePath, count: contacts.length }
    }
  )

  ipcMain.handle(
    IpcChannels.contactsImportThunderbird,
    async (): Promise<{ added: number; updated: number; skipped: number } | null> => {
      const profilePath = findThunderbirdProfile()
      if (!profilePath) return null
      return importContacts(db, readThunderbirdAddressBooks(profilePath))
    }
  )
}
