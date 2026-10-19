import { createTransport } from 'nodemailer'
import type { SqlDb } from '../db/sqlDb'
import type { IpcMain } from 'electron'
import { IpcChannels } from '@shared/ipcContracts'
import { scanThunderbird } from '../import/thunderbird'
import { discoverMailConfig } from '../accounts/autodiscover'
import type {
  AccountCreateInput,
  AccountUpdateInput,
  ConnectionTestInput,
  ConnectionTestResult,
  DiscoveryResult,
  ThunderbirdScanResult
} from '@peregrine/core/types'
import {
  deleteAccount,
  insertAccount,
  listAccounts,
  updateAccount
} from '../db/repositories/accountsRepo'
import { saveCredentials, updateCredentials } from '../credentials/CredentialStore'
import type { AccountManager } from '../accounts/AccountManager'
import { withTimeout } from '../util/withTimeout'
import { resolveHost } from '../smtp/SmtpClient'
import { createImapSession } from '../imap/createSession'
import { getAppSettings } from '../db/repositories/appSettingsRepo'

const TEST_TIMEOUT_MS = 15_000

// Through the same session an account really uses, so the test answers for what will happen when
// the account is saved. It used to be a connection of its own, which was lenient about STARTTLS
// where the real one insists, and so could report success for a server the account could then
// not connect to.
async function testImapConnection(
  input: ConnectionTestInput,
  useBuiltIn: boolean
): Promise<string | undefined> {
  const session = createImapSession(
    {
      host: input.imapHost,
      port: input.imapPort,
      secure: input.imapSecure,
      username: input.imapUsername,
      password: input.imapPassword
    },
    useBuiltIn
  )
  try {
    await withTimeout(session.connect(), TEST_TIMEOUT_MS, 'IMAP connection')
    await session.disconnect()
    return undefined
  } catch (err) {
    await session.disconnect()
    return err instanceof Error ? err.message : String(err)
  }
}

async function testSmtpConnection(input: ConnectionTestInput): Promise<string | undefined> {
  // Resolved through the operating system for the same reason as in SmtpClient: nodemailer's
  // own lookup is dropped behind a VPN, and a connection test that fails there would send
  // the user hunting for a problem in their settings.
  const address = await resolveHost(input.smtpHost)
  const transporter = createTransport({
    host: address,
    tls: address === input.smtpHost ? undefined : { servername: input.smtpHost },
    port: input.smtpPort,
    secure: input.smtpSecure === 'tls',
    requireTLS: input.smtpSecure === 'starttls',
    auth: { user: input.smtpUsername, pass: input.smtpPassword },
    connectionTimeout: TEST_TIMEOUT_MS,
    greetingTimeout: TEST_TIMEOUT_MS,
    socketTimeout: TEST_TIMEOUT_MS
  })
  try {
    await withTimeout(transporter.verify(), TEST_TIMEOUT_MS, 'SMTP connection')
    return undefined
  } catch (err) {
    transporter.close()
    return err instanceof Error ? err.message : String(err)
  }
}

/**
 * Reading a Thunderbird profile is a file read, not a mail operation, so it needs no account
 * and no connection. It is offered here because that is where the result is used.
 */
function registerThunderbirdImport(ipcMain: IpcMain): void {
  ipcMain.handle(IpcChannels.importThunderbirdScan, (): ThunderbirdScanResult => scanThunderbird())
}

export function registerAccountsIpc(
  ipcMain: IpcMain,
  db: SqlDb,
  accountManager: AccountManager
): void {
  registerThunderbirdImport(ipcMain)

  ipcMain.handle(IpcChannels.accountsList, () => {
    return listAccounts(db)
  })

  ipcMain.handle(
    IpcChannels.accountsDiscover,
    (_event, args: { email: string }): Promise<DiscoveryResult> => discoverMailConfig(args.email)
  )

  ipcMain.handle(
    IpcChannels.accountsTestConnection,
    async (_event, input: ConnectionTestInput): Promise<ConnectionTestResult> => {
      const useBuiltIn = (await getAppSettings(db)).experimentalImapClient
      const [imapError, smtpError] = await Promise.all([
        testImapConnection(input, useBuiltIn),
        testSmtpConnection(input)
      ])
      return {
        imapOk: !imapError,
        smtpOk: !smtpError,
        imapError,
        smtpError
      }
    }
  )

  ipcMain.handle(
    IpcChannels.accountsCreate,
    async (_event, input: AccountCreateInput): Promise<{ accountId: string }> => {
      const accountId = await insertAccount(db, {
        displayName: input.displayName,
        emailAddress: input.emailAddress,
        imapHost: input.imapHost,
        imapPort: input.imapPort,
        imapSecure: input.imapSecure,
        imapUsername: input.imapUsername,
        smtpHost: input.smtpHost,
        smtpPort: input.smtpPort,
        smtpSecure: input.smtpSecure,
        smtpUsername: input.smtpUsername
      })
      await saveCredentials(db, accountId, input.imapPassword, input.smtpPassword)
      await accountManager.startAccount(accountId)
      return { accountId }
    }
  )

  ipcMain.handle(IpcChannels.accountsRemove, async (_event, { accountId }: { accountId: string }) => {
    await accountManager.stopAccount(accountId)
    await deleteAccount(db, accountId)
  })

  ipcMain.handle(IpcChannels.accountsUpdate, async (_event, input: AccountUpdateInput) => {
    const { accountId, imapPassword, smtpPassword, ...fields } = input
    await updateAccount(db, accountId, fields)
    await updateCredentials(db, accountId, imapPassword, smtpPassword)

    // Connection-relevant changes only take effect on a fresh connection, so cycle the account
    // whenever server/credential fields moved; cosmetic-only edits keep the session alive.
    const connectionFields: (keyof AccountUpdateInput)[] = [
      'imapHost',
      'imapPort',
      'imapSecure',
      'imapUsername',
      'smtpHost',
      'smtpPort',
      'smtpSecure',
      'smtpUsername'
    ]
    const connectionChanged =
      imapPassword != null ||
      smtpPassword != null ||
      connectionFields.some((field) => input[field] !== undefined)

    if (connectionChanged) {
      await accountManager.stopAccount(accountId)
      await accountManager.startAccount(accountId)
    }
  })
}
