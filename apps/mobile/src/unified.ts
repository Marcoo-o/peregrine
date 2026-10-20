import type { SqlDb } from '@peregrine/core/sqlDb'
import type { Account } from './accounts'
import type { Connections } from './connections'
import { explainError } from './errors'
import { listFolders, syncFolders, type Folder } from './folders'
import type { MailActions } from './mailActions'
import { toStoredMessage, type StoredMessage } from './messages'
import { syncFolder } from './sync'

/** A message of the unified list: where it is, and whose it is. */
export interface UnifiedMessage extends StoredMessage {
  accountId: string
  folderId: string
  accountName: string
  /** The colour of the account, which marks the message in the list. */
  accountColor: string
}

/** How many the list shows. A list of everything would read the whole mailbox for one screen. */
export const UNIFIED_LIMIT = 200

/** Whether a folder is the inbox: the server says so, or it is called INBOX, which every server has. */
export function isInbox(folder: Pick<Folder, 'specialUse' | 'imapPath'>): boolean {
  return folder.specialUse === '\\Inbox' || folder.imapPath.toUpperCase() === 'INBOX'
}

/**
 * The newest messages of every account's inbox, merged by date, newest first. A message without a
 * date comes last, and two with the same one keep the order of their UIDs.
 */
export async function listUnified(db: SqlDb, limit: number = UNIFIED_LIMIT): Promise<UnifiedMessage[]> {
  const rows = await db.all<{
    uid: number
    subject: string
    sender: string
    date_ms: number | null
    flags: string
    size: number
    has_attachment: number
    pending_move_to: string | null
    account_id: string
    folder_id: string
    account_name: string
    account_color: string
  }>(
    `SELECT m.uid, m.subject, m.sender, m.date_ms, m.flags, m.size, m.has_attachment, m.pending_move_to,
            m.account_id, m.folder_id, a.display_name AS account_name, a.color AS account_color
     FROM messages m
     JOIN folders f ON f.id = m.folder_id
     JOIN accounts a ON a.id = m.account_id
     WHERE f.special_use = '\\Inbox' OR upper(f.imap_path) = 'INBOX'
     ORDER BY m.date_ms IS NULL, m.date_ms DESC, m.uid DESC
     LIMIT ?`,
    limit
  )
  return rows.map((row) => ({
    ...toStoredMessage(row),
    accountId: row.account_id,
    folderId: row.folder_id,
    accountName: row.account_name,
    accountColor: row.account_color
  }))
}

/** What happened to one account when the list was brought up to date. */
export interface RefreshResult {
  accountId: string
  accountName: string
  /** The reason it could not be brought up to date, or undefined when it could. */
  error?: string
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Keine Antwort nach ${Math.round(ms / 1000)} Sekunden`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

/**
 * Brings the inbox of each account up to date: connects it if it is not connected, replays what
 * waited in its queue, takes its folders and fetches its inbox.
 *
 * The accounts are handled together and each on its own. One that cannot be reached, or does not
 * answer, is named with its reason and the others are not held up by it, which is what makes a list
 * of several accounts worth having: a server that is down is not the end of the mail from the rest.
 * Replaying the queue comes first so that what the user decided is on the server before its
 * flags are read back from it.
 */
export async function refreshInboxes(
  context: { db: SqlDb; connections: Connections; mail: MailActions; timeoutMs?: number },
  accounts: Account[]
): Promise<RefreshResult[]> {
  const { db, connections, mail, timeoutMs = 30_000 } = context
  return Promise.all(
    accounts.map(async (account): Promise<RefreshResult> => {
      try {
        await withTimeout(
          (async () => {
            const imap = await connections.ensure(account)
            await mail.flush(account.id)
            await syncFolders(db, account.id, await imap.listMailboxes())
            const inbox = (await listFolders(db, account.id)).find(isInbox)
            if (inbox) await syncFolder(imap, db, inbox)
          })(),
          timeoutMs
        )
        return { accountId: account.id, accountName: account.displayName }
      } catch (error) {
        return {
          accountId: account.id,
          accountName: account.displayName,
          error: explainError(error)
        }
      }
    })
  )
}
