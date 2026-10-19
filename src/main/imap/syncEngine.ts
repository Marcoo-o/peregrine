import type { SqlDb } from '../db/sqlDb'
import type { EmailAddress, SpecialUse } from '@peregrine/core/types'
import {
  countFolderMessages,
  getFolderByPath,
  getFolderSyncState,
  invalidateFolderCache,
  setFolderParent,
  upsertFolder
} from '../db/repositories/foldersRepo'
import { reconcileFlags, upsertEnvelope } from '../db/repositories/messagesRepo'
import { upsertContactFromMail } from '../db/repositories/contactsRepo'
import type { ImapSession } from '@peregrine/core/imapSession'

function mapSpecialUse(flags: string[] | undefined, path: string): SpecialUse {
  const flagSet = new Set((flags ?? []).map((f) => f.toLowerCase()))
  if (flagSet.has('\\inbox') || path.toUpperCase() === 'INBOX') return 'inbox'
  if (flagSet.has('\\sent')) return 'sent'
  if (flagSet.has('\\drafts')) return 'drafts'
  if (flagSet.has('\\trash')) return 'trash'
  if (flagSet.has('\\junk')) return 'junk'
  if (flagSet.has('\\archive')) return 'archive'
  return null
}

export async function syncFolderList(
  db: SqlDb,
  accountId: string,
  connection: ImapSession
): Promise<void> {
  const mailboxes = await connection.listMailboxes()

  // Pass 1: upsert every mailbox first, so pass 2 can resolve parent/child ids regardless of list order.
  for (const mailbox of mailboxes) {
    const flags = mailbox.specialUse ? [mailbox.specialUse] : mailbox.flags
    await upsertFolder(db, {
      accountId,
      imapPath: mailbox.path,
      displayName: mailbox.name,
      specialUse: mapSpecialUse(flags, mailbox.path),
      parentId: null
    })
  }

  // Pass 2: link each folder to its parent via IMAP's reported parentPath.
  for (const mailbox of mailboxes) {
    if (!mailbox.parentPath) continue
    const child = await getFolderByPath(db, accountId, mailbox.path)
    const parent = await getFolderByPath(db, accountId, mailbox.parentPath)
    if (child && parent) {
      await setFolderParent(db, child.id, parent.id)
    }
  }
}

function addressesFromEnvelope(
  addresses: Array<{ name?: string; address?: string }> | undefined
): EmailAddress[] {
  if (!addresses) return []
  return addresses.map((a) => ({
    name: a.name ?? '',
    address: a.address ?? ''
  }))
}

/** Counters for judging whether the skip actually skips; read by the sync IPC handler. */
export const syncStats = { skipped: 0, fetched: 0 }

export interface NewMessageRef {
  id: string
  uid: number
}

export async function syncFolderEnvelopes(
  db: SqlDb,
  accountId: string,
  connection: ImapSession,
  imapPath: string
): Promise<{ folderId: string; newCount: number; newMessages: NewMessageRef[] }> {
  const existingFolder = await getFolderByPath(db, accountId, imapPath)

  const stored =
    existingFolder?.id && existingFolder.imapPath === imapPath
      ? await getFolderSyncState(db, existingFolder.id)
      : undefined

  /**
   * Skip folders that cannot have changed.
   *
   * A STATUS query is answered from the server's index, while selecting a mailbox is a full
   * exchange. And a refresh across several accounts spends its time on those selections, not
   * on data. When UIDVALIDITY, UIDNEXT and the message count all match what is stored, no
   * message has arrived or gone, and there is nothing for a selection to discover.
   *
   * The trade-off is that a message marked read in another client, in a folder that is
   * otherwise unchanged, is noticed only on the next real sync of that folder. The inbox is
   * exempt from this: it is where that matters, and IDLE watches it anyway.
   */
  if (existingFolder?.id && stored?.validity != null && stored.next != null) {
    try {
      const status = await connection.mailboxStatus(imapPath)
      const localCount = await countFolderMessages(db, existingFolder.id)
      const unchanged =
        BigInt(stored.validity) === status.uidValidity &&
        stored.next === status.uidNext &&
        localCount === status.messages
      if (unchanged) {
        syncStats.skipped += 1
        return { folderId: existingFolder.id, newCount: 0, newMessages: [] }
      }
      syncStats.fetched += 1
    } catch {
      // A server without STATUS, or one that refuses it: fall through to the full path.
    }
  }

  let renumbered = false

  /**
   * One mailbox selection for the whole folder.
   *
   * Only the messages that arrived since last time get envelope and body structure. For a
   * message already known, neither can have changed, only its flags. The range is decided
   * inside the selection so that reading UIDVALIDITY costs no extra round trip.
   *
   * `${from}:*` always returns at least the highest UID even when nothing is new; that is
   * IMAP's definition rather than a mistake, and the one message is simply re-upserted.
   */
  const { messages, flags: remoteFlags, uidValidity, uidNext } = await connection.syncFetch(
    imapPath,
    async (status) => {
      // A changed UIDVALIDITY means the server renumbered everything: the stored UIDs now
      // point at different messages, so the cache has to go rather than be reconciled.
      renumbered = stored?.validity != null && BigInt(stored.validity) !== status.uidValidity
      if (renumbered && existingFolder?.id) await invalidateFolderCache(db, existingFolder.id)

      const knownUidNext = renumbered ? null : (stored?.next ?? null)
      return knownUidNext && knownUidNext > 1 ? `${knownUidNext}:*` : '1:*'
    }
  )

  const folderId = await upsertFolder(db, {
    accountId,
    imapPath,
    displayName: existingFolder?.displayName ?? imapPath,
    specialUse: existingFolder?.specialUse ?? null,
    parentId: existingFolder?.parentId ?? null,
    uidValidity: Number(uidValidity),
    uidNext
  })

  const newMessages: NewMessageRef[] = []
  await db.transaction(async (tx) => {
    for (const msg of messages) {
      const envelope = msg.envelope
      const from = addressesFromEnvelope(envelope.from)
      const to = addressesFromEnvelope(envelope.to)
      const cc = addressesFromEnvelope(envelope.cc)
      const bcc = addressesFromEnvelope(envelope.bcc)
      const flags = msg.flags

      const { id, isNew } = await upsertEnvelope(tx, {
        accountId,
        folderId,
        uid: msg.uid,
        messageIdHeader: envelope.messageId ?? null,
        inReplyTo: envelope.inReplyTo ?? null,
        referencesHeader: null,
        subject: envelope.subject ?? '',
        fromName: from[0]?.name ?? '',
        fromAddress: from[0]?.address ?? '',
        to,
        cc,
        bcc,
        date: envelope.date ? new Date(envelope.date).toISOString() : new Date(0).toISOString(),
        isRead: flags.includes('\\Seen'),
        isFlagged: flags.includes('\\Flagged'),
        hasAttachments: msg.hasAttachment,
        previewText: '',
        sizeBytes: msg.size,
        flags
      })
      if (isNew) {
        newMessages.push({ id, uid: msg.uid })
        if (from[0]?.address) await upsertContactFromMail(tx, from[0].name ?? '', from[0].address)
      }
    }
  })

  await reconcileFlags(db, folderId, remoteFlags)

  return { folderId, newCount: newMessages.length, newMessages }
}
