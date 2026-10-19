import { appError } from '@peregrine/core/errorText'
import { windowBackground } from '../windowTheme'
import type { SqlDb } from '../db/sqlDb'
import { randomUUID } from 'node:crypto'
import { app, BrowserWindow, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { IpcChannels } from '@shared/ipcContracts'
import type { ComposeInput, ComposeSeed } from '@peregrine/core/types'
import { getAccount } from '../db/repositories/accountsRepo'
import { attachEditingMenu, menuTexts } from '../spellcheck'
import { getAppSettings } from '../db/repositories/appSettingsRepo'
import { getDefaultIdentity, getIdentity } from '../db/repositories/identitiesRepo'
import { getFolderBySpecialUse } from '../db/repositories/foldersRepo'
import { upsertContactFromMail } from '../db/repositories/contactsRepo'
import { getAccountPgpKey, getContactPgpKeyByEmail } from '../db/repositories/pgpKeysRepo'
import { encryptMimeEntity, signMimeEntity } from '../pgp/pgpService'
import { buildRawMessage, type OutgoingMessage } from '../smtp/messageBuilder'
import {
  buildContentEntity,
  buildEncryptedMessage,
  buildSignedMessage
} from '../smtp/pgpMime'
import type { AccountManager } from '../accounts/AccountManager'

/**
 * The address a message is sent from.
 *
 * Resolved from the chosen identity, falling back to the account's own address. An identity
 * that belongs to a different account is ignored rather than honoured: the message goes out
 * over this account's server, and a From it is not authorised for would be rejected by the
 * server or land the mail in spam.
 */
async function senderAddress(
  db: SqlDb,
  accountId: string,
  identityId: string | undefined
): Promise<string> {
  const identity = identityId
    ? await getIdentity(db, identityId)
    : await getDefaultIdentity(db, accountId)
  const usable =
    identity && identity.accountId === accountId ? identity : await getDefaultIdentity(db, accountId)
  if (!usable) return (await getAccount(db, accountId))?.emailAddress ?? ''
  return usable.displayName
    ? `"${usable.displayName}" <${usable.emailAddress}>`
    : usable.emailAddress
}

function formatAddress(a: { name: string; address: string }): string {
  return a.name ? `"${a.name}" <${a.address}>` : a.address
}

/** Pulls the bare address back out of a formatted `"Name" <addr>` string. */
function addressOnly(formatted: string): string {
  const match = /<([^>]+)>/.exec(formatted)
  return (match ? match[1] : formatted).trim()
}

function toOutgoing(
  input: ComposeInput,
  fromAddress: string,
  textBody: string,
  htmlBody: string
): Parameters<typeof buildRawMessage>[0] {
  return {
    from: fromAddress,
    to: input.to.map(formatAddress),
    cc: input.cc.map(formatAddress),
    bcc: input.bcc.map(formatAddress),
    subject: input.subject,
    text: textBody,
    html: htmlBody,
    attachments: input.attachments,
    inReplyTo: input.inReplyTo,
    references: input.references
  }
}

interface ProtectionOptions {
  encrypt: boolean
  sign: boolean
}

/**
 * Wraps the message as PGP/MIME. Encrypted, signed, or both.
 *
 * Encrypting implies signing here: the recipient can only tell an encrypted message apart
 * from one an attacker encrypted to the same key if it carries a signature, and the sender's
 * key is available anyway.
 */
async function buildProtectedMessage(
  db: SqlDb,
  accountId: string,
  outgoing: OutgoingMessage,
  envelope: Parameters<typeof buildSignedMessage>[0],
  options: ProtectionOptions
): Promise<Buffer> {
  const senderKey = await getAccountPgpKey(db, accountId)
  if (!senderKey) {
    throw appError('noAccountKey')
  }

  const entity = await buildContentEntity(outgoing)

  if (options.encrypt) {
    const recipientKeys: string[] = []
    const missing: string[] = []
    for (const recipient of [...outgoing.to, ...outgoing.cc, ...outgoing.bcc]) {
      const address = addressOnly(recipient)
      const key = await getContactPgpKeyByEmail(db, address)
      if (key) recipientKeys.push(key)
      else missing.push(address)
    }
    if (missing.length > 0) {
      throw appError('noPublicKeyFor', missing.join(', '))
    }
    // The sender needs to stay able to read the message in the Sent folder.
    recipientKeys.push(senderKey.publicKeyArmored)

    const ciphertext = await encryptMimeEntity(entity, recipientKeys, senderKey.privateKeyArmored)
    return buildEncryptedMessage(envelope, ciphertext)
  }

  const signature = await signMimeEntity(entity, senderKey.privateKeyArmored)
  return buildSignedMessage(envelope, entity, signature)
}

/**
 * Encrypts a draft of an encrypted message to the author's own key.
 *
 * A draft sits on the same server the finished message will pass through, so leaving it in
 * the clear would give away exactly the content the user asked to protect. Only earlier.
 * The recipients' keys deliberately play no part: a draft only ever has to be readable by the
 * person writing it, and autosave must not start failing because a recipient typed half an
 * hour ago has no key on file yet.
 */
async function buildEncryptedDraft(
  db: SqlDb,
  accountId: string,
  outgoing: OutgoingMessage
): Promise<Buffer> {
  const senderKey = await getAccountPgpKey(db, accountId)
  if (!senderKey) {
    throw appError('noAccountKey')
  }

  const entity = await buildContentEntity(outgoing)
  const ciphertext = await encryptMimeEntity(entity, [senderKey.publicKeyArmored], null)
  return buildEncryptedMessage(
    {
      from: outgoing.from,
      to: outgoing.to,
      cc: outgoing.cc,
      bcc: outgoing.bcc,
      subject: outgoing.subject,
      inReplyTo: outgoing.inReplyTo,
      references: outgoing.references
    },
    ciphertext
  )
}

// Compose windows are seeded out of band: the window is created first and asks for its content
// once its renderer is up, so nothing has to be squeezed through the URL.
const pendingSeeds = new Map<string, ComposeSeed>()

/**
 * Messages waiting out their grace period.
 *
 * Module scope rather than per-window: the compose window closes the moment the user hits
 * send, and the message has to survive that.
 */
const pendingSends = new Map<string, { timer: NodeJS.Timeout; input: ComposeInput }>()

/** Sends everything still waiting. Called on quit, so nothing is lost by closing the app. */
export async function flushPendingSends(
  send: (input: ComposeInput) => Promise<unknown>
): Promise<void> {
  const waiting = [...pendingSends.values()]
  pendingSends.clear()
  for (const { timer, input } of waiting) {
    clearTimeout(timer)
    try {
      await send({ ...input, sendNow: true })
    } catch (err) {
      console.error('flushing a pending send failed:', err instanceof Error ? err.message : err)
    }
  }
}

function createComposeWindow(seed: ComposeSeed, db: SqlDb): void {
  const seedId = randomUUID()
  pendingSeeds.set(seedId, seed)

  const win = new BrowserWindow({
    width: 780,
    height: 680,
    show: false,
    backgroundColor: windowBackground(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // The composer is where spelling actually matters, so the editing menu goes here too.
  attachEditingMenu(win, async () => menuTexts((await getAppSettings(db)).language, app.getLocale()))

  // Without a handler a clicked link would open as a bare Electron window with no address
  // bar. The same trap the reader window avoids, and quoted mail is full of links.
  win.webContents.setWindowOpenHandler(({ url }) => {
    win.webContents.send(IpcChannels.linkActivated, { url })
    return { action: 'deny' }
  })

  win.on('ready-to-show', () => win.show())
  win.on('closed', () => pendingSeeds.delete(seedId))

  const hash = `#compose=${seedId}`
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}${hash}`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash })
  }
}

export function registerComposeIpc(ipcMain: IpcMain, db: SqlDb, accountManager: AccountManager): void {
  // The queue replays messages that were written without a connection; sending lives here,
  // so it is handed over rather than imported the other way round.
  accountManager.setSendHandler((input) => performSend(input))

  /**
   * Sends, and keeps the message when that does not work.
   *
   * Whether a failure is the network's fault cannot be told apart from the error alone. And
   * for a message the difference does not matter much: losing what someone wrote is worse
   * than trying again. The queue gives up after five connections and says so, so a message
   * the server will never accept does not retry forever either.
   *
   * Asking the account manager whether the account is "connected" is not enough here: the
   * SMTP client exists as soon as the account runs, and it is the IMAP side that decides
   * that. A mail server can be unreachable while the mailbox is not.
   */
  async function sendOrQueue(input: ComposeInput): Promise<{ messageId: string }> {
    try {
      return await performSend(input)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('sending failed, kept for later:', message)
      await accountManager.enqueueOffline(input.accountId, 'send', { input })
      notifySendFailed('', message)
      return { messageId: '' }
    }
  }

  /**
   * Says what happened, in the mailbox rather than in the compose window.
   *
   * The window is closed by the time a send fails. It closes the moment the user hits send,
   * so this is the only place left that can report it. The message itself is not lost; it is
   * in the queue, and the chip in the topbar keeps saying so.
   */
  function notifySendFailed(pendingId: string, message: string): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcChannels.sendFailed, { pendingId, message })
    }
  }

  ipcMain.handle(IpcChannels.composeOpenWindow, (_event, seed: ComposeSeed): void => {
    createComposeWindow(seed, db)
  })

  ipcMain.handle(
    IpcChannels.composeGetSeed,
    (_event, { seedId }: { seedId: string }): ComposeSeed | null => pendingSeeds.get(seedId) ?? null
  )

  ipcMain.handle(IpcChannels.composeCloseWindow, (event: IpcMainInvokeEvent): void => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  /**
   * Drafts are stored server-side like every other client does it: append the new revision to
   * the drafts folder, then drop the previous one. Appending first means a failure mid-save
   * can leave two revisions, never zero.
   */
  ipcMain.handle(
    IpcChannels.composeSaveDraft,
    async (_event, input: ComposeInput): Promise<{ draftUid: number | null; savedAt: string }> => {
      const account = await getAccount(db, input.accountId)
      const imap = accountManager.getImapConnection(input.accountId)
      const draftsFolder = await getFolderBySpecialUse(db, input.accountId, 'drafts')
      if (!account || !imap || !draftsFolder) {
        throw appError('draftsUnavailable')
      }

      const outgoing = toOutgoing(
        input,
        await senderAddress(db, input.accountId, input.identityId),
        input.textBody,
        input.htmlBody
      )
      const raw = input.encrypt
        ? await buildEncryptedDraft(db, input.accountId, outgoing)
        : await buildRawMessage(outgoing)
      const draftUid = await imap.appendMessage(draftsFolder.imapPath, raw, ['\\Draft', '\\Seen'])

      if (input.draftUid != null) {
        try {
          await imap.deleteMessages(draftsFolder.imapPath, [input.draftUid])
        } catch (err) {
          console.error('dropping previous draft failed:', err instanceof Error ? err.message : err)
        }
      }

      return { draftUid, savedAt: new Date().toISOString() }
    }
  )

  ipcMain.handle(
    IpcChannels.composeDeleteDraft,
    async (_event, args: { accountId: string; uid: number }): Promise<void> => {
      const imap = accountManager.getImapConnection(args.accountId)
      const draftsFolder = await getFolderBySpecialUse(db, args.accountId, 'drafts')
      if (!imap || !draftsFolder) return
      await imap.deleteMessages(draftsFolder.imapPath, [args.uid])
    }
  )

  ipcMain.handle(
    IpcChannels.composeSend,
    async (_event, input: ComposeInput): Promise<{ messageId: string; pendingId?: string }> => {
      /**
       * A grace period before the mail actually leaves.
       *
       * Everything below runs unchanged once it elapses. The delay sits in front of the
       * send, not inside it, so a cancelled message never touched the server at all and
       * needs no recalling. Pending sends are flushed on quit rather than dropped: a message
       * the user considers sent must not vanish because the app closed.
       */
      /**
       * A chosen moment turns the send into a queue entry straight away.
       *
       * It never touches the server now, so there is nothing to recall. The same reason the
       * undo grace period sits in front of the send rather than inside it. Cancelling before
       * the moment simply removes the row.
       */
      if (input.sendAt && input.sendAt > Date.now()) {
        await accountManager.enqueueOffline(input.accountId, 'send', { input }, input.sendAt)
        return { messageId: '' }
      }

      const delaySeconds = (await getAppSettings(db)).undoSendSeconds
      if (delaySeconds > 0 && !input.sendNow) {
        const pendingId = randomUUID()
        const timer = setTimeout(() => {
          pendingSends.delete(pendingId)
          // Kept rather than reported as lost: the window is long gone by now, and a message
          // that only exists in an error toast is a message nobody gets back.
          void sendOrQueue({ ...input, sendNow: true })
        }, delaySeconds * 1000)
        pendingSends.set(pendingId, { timer, input })
        // The compose window closes right away, so the countdown has to be offered by the
        // mailbox instead. It is the window that outlives the send.
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send(IpcChannels.sendScheduled, {
            pendingId,
            seconds: delaySeconds,
            subject: input.subject
          })
        }
        return { messageId: '', pendingId }
      }
      return sendOrQueue(input)
    }
  )

  ipcMain.handle(
    IpcChannels.composeCancelSend,
    (_event, { pendingId }: { pendingId: string }): { cancelled: boolean } => {
      const pending = pendingSends.get(pendingId)
      if (!pending) return { cancelled: false }
      clearTimeout(pending.timer)
      pendingSends.delete(pendingId)
      return { cancelled: true }
    }
  )

  /**
   * Quitting must not swallow a message the user considers sent.
   *
   * The grace period is a courtesy, not a queue: whatever is still waiting goes out now
   * rather than being dropped. Quitting is held back until they are away.
   */
  app.on('before-quit', (event) => {
    if (pendingSends.size === 0) return
    event.preventDefault()
    void flushPendingSends(performSend).finally(() => app.quit())
  })

  /** Sends immediately; everything that was already here. */
  async function performSend(input: ComposeInput): Promise<{ messageId: string }> {
      const account = await getAccount(db, input.accountId)
      const smtp = accountManager.getSmtpClient(input.accountId)
      const imap = accountManager.getImapConnection(input.accountId)
      if (!account || !smtp) {
        throw appError('notConnected')
      }

      const outgoing = toOutgoing(
        input,
        await senderAddress(db, input.accountId, input.identityId),
        input.textBody,
        input.htmlBody
      )
      const envelope = {
        from: outgoing.from,
        to: outgoing.to,
        cc: outgoing.cc,
        bcc: outgoing.bcc,
        subject: outgoing.subject,
        inReplyTo: outgoing.inReplyTo,
        references: outgoing.references
      }

      const { messageId, rawSource } =
        input.encrypt || input.sign
          ? await smtp.sendRaw(
              await buildProtectedMessage(db, input.accountId, outgoing, envelope, {
                encrypt: Boolean(input.encrypt),
                sign: Boolean(input.sign)
              }),
              envelope
            )
          : await smtp.sendMail(outgoing)

      if (imap) {
        const sentFolder = await getFolderBySpecialUse(db, input.accountId, 'sent')
        if (sentFolder) {
          await imap.appendMessage(sentFolder.imapPath, rawSource)
        }

        // The draft this mail was written in has served its purpose once the mail is out.
        const draftsFolder = await getFolderBySpecialUse(db, input.accountId, 'drafts')
        if (input.draftUid != null && draftsFolder) {
          try {
            await imap.deleteMessages(draftsFolder.imapPath, [input.draftUid])
          } catch (err) {
            console.error('removing sent draft failed:', err instanceof Error ? err.message : err)
          }
        }
      }

      for (const recipient of [...input.to, ...input.cc]) {
        if (recipient.address) await upsertContactFromMail(db, recipient.name, recipient.address)
      }

      return { messageId }
  }
}
