import type { SqlDb } from '@peregrine/core/sqlDb'
import type { Account } from './accounts'
import type { Connections } from './connections'
import { SEEN } from './flags'
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

/** The folders that every account has and that are shown as one for all of them, in the order the desktop shows them. */
export type UnifiedRole = 'inbox' | 'drafts' | 'sent' | 'archive' | 'junk' | 'trash'
export const UNIFIED_ROLES: readonly UnifiedRole[] = ['inbox', 'drafts', 'sent', 'archive', 'junk', 'trash']

/** The role the server names for the folders of each role, apart from the inbox, which is told by its name too. */
const USE_OF_ROLE: Record<Exclude<UnifiedRole, 'inbox'>, string> = {
  drafts: '\\Drafts',
  sent: '\\Sent',
  archive: '\\Archive',
  junk: '\\Junk',
  trash: '\\Trash'
}

/** The role a folder has among those that are shown as one for all accounts, or null for any other folder. */
export function roleOf(folder: Pick<Folder, 'specialUse' | 'imapPath'>): UnifiedRole | null {
  if (isInbox(folder)) return 'inbox'
  const found = UNIFIED_ROLES.find((role) => role !== 'inbox' && USE_OF_ROLE[role] === folder.specialUse)
  return found ?? null
}

/** Which folders a role is, as a condition on `f`, the folders, of a statement. */
function roleCondition(role: UnifiedRole): { sql: string; params: string[] } {
  if (role === 'inbox') return { sql: "(f.special_use = '\\Inbox' OR upper(f.imap_path) = 'INBOX')", params: [] }
  return { sql: 'f.special_use = ?', params: [USE_OF_ROLE[role]] }
}

/** What is read for a message of a list that holds those of several accounts, besides the message itself. */
export const UNIFIED_COLUMNS = `m.uid, m.subject, m.sender, m.date_ms, m.flags, m.size, m.has_attachment, m.pending_move_to,
            m.account_id, m.folder_id, a.display_name AS account_name, a.color AS account_color`

export interface UnifiedRow {
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
}

export function toUnifiedMessage(row: UnifiedRow): UnifiedMessage {
  return {
    ...toStoredMessage(row),
    accountId: row.account_id,
    folderId: row.folder_id,
    accountName: row.account_name,
    accountColor: row.account_color
  }
}

/**
 * The newest messages of the folders of a role of every account, the inbox unless it is told another, merged by
 * date, newest first. A message without a date comes last, and two with the same one keep the order of their UIDs.
 */
export async function listUnified(
  db: SqlDb,
  limit: number = UNIFIED_LIMIT,
  role: UnifiedRole = 'inbox'
): Promise<UnifiedMessage[]> {
  const where = roleCondition(role)
  const rows = await db.all<UnifiedRow>(
    `SELECT ${UNIFIED_COLUMNS}
     FROM messages m
     JOIN folders f ON f.id = m.folder_id
     JOIN accounts a ON a.id = m.account_id
     WHERE ${where.sql}
     ORDER BY m.date_ms IS NULL, m.date_ms DESC, m.uid DESC
     LIMIT ?`,
    ...where.params,
    limit
  )
  return rows.map(toUnifiedMessage)
}

/** How many messages of each role are not read, over all accounts. A role with none is 0. */
export async function unifiedUnread(db: SqlDb): Promise<Record<UnifiedRole, number>> {
  const counts: Record<UnifiedRole, number> = { inbox: 0, drafts: 0, sent: 0, archive: 0, junk: 0, trash: 0 }
  const rows = await db.all<{ special_use: string | null; imap_path: string; unread: number }>(
    `SELECT f.special_use, f.imap_path, COUNT(*) AS unread
     FROM messages m
     JOIN folders f ON f.id = m.folder_id
     WHERE NOT EXISTS (SELECT 1 FROM json_each(m.flags) WHERE lower(json_each.value) = lower(?))
     GROUP BY f.id`,
    SEEN
  )
  for (const row of rows) {
    const role = roleOf({ specialUse: row.special_use, imapPath: row.imap_path })
    if (role) counts[role] += row.unread
  }
  return counts
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
 * Brings the folder of a role of each account up to date, the inbox for what is called the inboxes: connects the
 * account if it is not connected, replays what waited in its queue, takes its folders and fetches that one.
 *
 * The accounts are handled together and each on its own. One that cannot be reached, or does not
 * answer, is named with its reason and the others are not held up by it, which is what makes a list
 * of several accounts worth having: a server that is down is not the end of the mail from the rest.
 * Replaying the queue comes first so that what the user decided is on the server before its
 * flags are read back from it.
 */
export async function refreshRole(
  context: { db: SqlDb; connections: Connections; mail: MailActions; timeoutMs?: number },
  accounts: Account[],
  role: UnifiedRole
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
            const folder = (await listFolders(db, account.id)).find((candidate) => roleOf(candidate) === role)
            if (folder) await syncFolder(imap, db, folder)
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

/** Brings the inbox of each account up to date. */
export const refreshInboxes = (
  context: { db: SqlDb; connections: Connections; mail: MailActions; timeoutMs?: number },
  accounts: Account[]
): Promise<RefreshResult[]> => refreshRole(context, accounts, 'inbox')
