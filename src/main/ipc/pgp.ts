import { appError } from '@peregrine/core/errorText'
import type { SqlDb } from '../db/sqlDb'
import { dialog, type BrowserWindow, type IpcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import { IpcChannels } from '@shared/ipcContracts'
import type {
  AccountKeyInfo,
  ContactKeyInfo,
  KeyImportResult,
  KeyImportSource,
  PgpKeyInfo
} from '@peregrine/core/types'
import {
  deleteAccountPgpKey,
  deleteContactPgpKey,
  getAccountPgpKey,
  getContactIdByEmail,
  getContactKeyInfoByEmail,
  getContactPgpKey,
  listAccountKeyInfos,
  setActiveAccountKey,
  listContactKeyInfos,
  listContactKeysFor,
  listContactKeyFingerprints,
  saveAccountPgpKey,
  saveContactPgpKey
} from '../db/repositories/pgpKeysRepo'
import { getAccount } from '../db/repositories/accountsRepo'
import { upsertContactFromMail } from '../db/repositories/contactsRepo'
import { generateKeyPair, getFingerprint, importKeyPair, keyFactsFrom } from '../pgp/pgpService'
import { discoverPublicKey, publishToKeyserver } from '../pgp/keyDiscovery'
import { importKeys, scanKeySource } from '../pgp/bundleImport'

export function registerPgpIpc(
  ipcMain: IpcMain,
  db: SqlDb,
  getWindow: () => BrowserWindow | undefined
): void {
  ipcMain.handle(
    IpcChannels.pgpGetKeyInfo,
    async (_event, args: { accountId: string }): Promise<PgpKeyInfo | null> => {
      const key = await getAccountPgpKey(db, args.accountId)
      if (!key) return null
      return { fingerprint: key.fingerprint, publicKeyArmored: key.publicKeyArmored }
    }
  )

  ipcMain.handle(
    IpcChannels.pgpGenerateKeyPair,
    async (_event, args: { accountId: string; name: string; email: string }): Promise<PgpKeyInfo> => {
      const generated = await generateKeyPair(args.name, args.email)
      await saveAccountPgpKey(
        db,
        args.accountId,
        generated.publicKeyArmored,
        generated.privateKeyArmored,
        generated.fingerprint
      )
      return { fingerprint: generated.fingerprint, publicKeyArmored: generated.publicKeyArmored }
    }
  )

  ipcMain.handle(
    IpcChannels.pgpImportKeyPair,
    async (
      _event,
      args: { accountId: string; privateKeyArmored: string; passphrase?: string }
    ): Promise<PgpKeyInfo> => {
      const imported = await importKeyPair(args.privateKeyArmored, args.passphrase ?? '')
      await saveAccountPgpKey(
        db,
        args.accountId,
        imported.publicKeyArmored,
        imported.privateKeyArmored,
        imported.fingerprint
      )
      return { fingerprint: imported.fingerprint, publicKeyArmored: imported.publicKeyArmored }
    }
  )

  ipcMain.handle(
    IpcChannels.pgpDeleteAccountKey,
    async (_event, args: { accountId: string; fingerprint?: string }): Promise<void> => {
      await deleteAccountPgpKey(db, args.accountId, args.fingerprint)
    }
  )

  /**
   * The ring, with expiry and revocation read out of each key.
   *
   * Parsed on demand rather than stored in columns: the armor is what the key actually says,
   * and a revocation that arrives later changes it without anything having to be migrated.
   */
  ipcMain.handle(
    IpcChannels.pgpListAccountKeys,
    async (_event, args: { accountId: string }): Promise<AccountKeyInfo[]> =>
      Promise.all(
        (await listAccountKeyInfos(db, args.accountId)).map(async (key) => {
          const facts = await keyFactsFrom(key.publicKeyArmored)
          return { ...key, expiresAt: facts.expiresAt, revoked: facts.revoked === true }
        })
      )
  )

  ipcMain.handle(
    IpcChannels.pgpSetActiveKey,
    async (_event, args: { accountId: string; fingerprint: string }): Promise<void> => {
      await setActiveAccountKey(db, args.accountId, args.fingerprint)
    }
  )

  ipcMain.handle(
    IpcChannels.pgpExportPublicKey,
    async (_event, args: { accountId: string }): Promise<{ savedPath: string | null }> => {
      const key = await getAccountPgpKey(db, args.accountId)
      const win = getWindow()
      if (!key || !win) return { savedPath: null }

      const account = await getAccount(db, args.accountId)
      const suggested = `${account?.emailAddress ?? 'peregrine'}-public.asc`
      const result = await dialog.showSaveDialog(win, {
        defaultPath: suggested,
        filters: [{ name: 'PGP public key', extensions: ['asc'] }]
      })
      if (result.canceled || !result.filePath) return { savedPath: null }

      await writeFile(result.filePath, key.publicKeyArmored, 'utf8')
      return { savedPath: result.filePath }
    }
  )

  ipcMain.handle(
    IpcChannels.pgpPublishKey,
    async (
      _event,
      args: { accountId: string }
    ): Promise<{ fingerprint: string; status: Record<string, string> }> => {
      const key = await getAccountPgpKey(db, args.accountId)
      if (!key) throw appError('noAccountKey')
      // Only the public half ever leaves the machine.
      return publishToKeyserver(key.publicKeyArmored)
    }
  )

  ipcMain.handle(
    IpcChannels.pgpSetContactPublicKey,
    async (
      _event,
      args: { contactId: string; publicKeyArmored: string }
    ): Promise<{ fingerprint: string }> => {
      const fingerprint = await getFingerprint(args.publicKeyArmored)
      await saveContactPgpKey(db, args.contactId, args.publicKeyArmored, fingerprint)
      return { fingerprint }
    }
  )

  ipcMain.handle(
    IpcChannels.pgpGetContactPublicKey,
    async (_event, args: { contactId: string }): Promise<string | null> => {
      return (await getContactPgpKey(db, args.contactId)) ?? null
    }
  )

  ipcMain.handle(
    IpcChannels.pgpDeleteContactKey,
    async (_event, args: { contactId: string }): Promise<void> => {
      await deleteContactPgpKey(db, args.contactId)
    }
  )

  ipcMain.handle(
    IpcChannels.pgpContactKeyFingerprints,
    (): Promise<Record<string, string>> => listContactKeyFingerprints(db)
  )

  ipcMain.handle(
    IpcChannels.pgpContactKeyForAddress,
    (_event, args: { email: string }): Promise<ContactKeyInfo | null> =>
      getContactKeyInfoByEmail(db, args.email)
  )

  ipcMain.handle(IpcChannels.pgpContactKeyRing, (_event, args: { contactId: string }) =>
    listContactKeysFor(db, args.contactId)
  )

  ipcMain.handle(IpcChannels.pgpListContactKeys, (): Promise<ContactKeyInfo[]> => listContactKeyInfos(db))

  ipcMain.handle(
    IpcChannels.pgpScanKeySource,
    (_event, args: { source: KeyImportSource }) => scanKeySource(db, args.source)
  )

  ipcMain.handle(IpcChannels.pgpChooseKeyFile, async (): Promise<{ path: string } | null> => {
    const win = getWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [
        // Thunderbird writes .asc on export; the rings themselves carry .gpg.
        { name: 'PGP keys', extensions: ['asc', 'gpg', 'pgp', 'key', 'pub', 'sec'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    const path = result.filePaths[0]
    return result.canceled || !path ? null : { path }
  })

  ipcMain.handle(
    IpcChannels.pgpImportKeys,
    (
      _event,
      args: { source: KeyImportSource; fingerprints: string[]; passphrase: string }
    ): Promise<KeyImportResult[]> =>
      importKeys(db, args.source, args.fingerprints, args.passphrase)
  )

  /**
   * Looks a key up by address alone.
   *
   * The reading pane knows a sender, not a contact. And the moment a signed message arrives
   * whose key is missing is exactly the moment one wants to fetch it. Requiring a contact
   * first would mean going to the settings, finding the person, and coming back.
   */
  ipcMain.handle(
    IpcChannels.pgpDiscoverForAddress,
    async (
      _event,
      args: { email: string; name?: string; accountId?: string }
    ): Promise<{ found: boolean; key?: ContactKeyInfo }> => {
      const discovered = await discoverPublicKey(args.email)
      if (!discovered) return { found: false }

      // The contact is created on the way: someone whose key is worth keeping is a contact,
      // and the key has nowhere to live otherwise.
      await upsertContactFromMail(db, args.name ?? '', args.email)
      const contactId = await getContactIdByEmail(db, args.email)
      if (!contactId) return { found: false }

      await saveContactPgpKey(db, contactId, discovered.publicKeyArmored, discovered.fingerprint, {
        source: discovered.source === 'WKD' ? 'wkd' : 'keyserver',
        accountId: args.accountId ?? null
      })
      return { found: true, key: (await getContactKeyInfoByEmail(db, args.email)) ?? undefined }
    }
  )
}
