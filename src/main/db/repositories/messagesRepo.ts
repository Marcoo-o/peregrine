import type { SqlDb } from '../sqlDb'
import { randomUUID } from 'node:crypto'
import type {
  EmailAddress,
  MessageDetail,
  MessageListFilter,
  MessageListPage,
  MessageSort,
  MessageSummary,
  SnoozeMode
} from '@peregrine/core/types'
import { assessSpam, type SpamAssessment } from '@peregrine/core/spamScore'
import {
  hasStructuredFilters,
  parseSearchQuery,
  type ParsedSearchQuery
} from '@peregrine/core/searchQuery'
import { parseAuthenticationResults, type AuthResults } from '@peregrine/core/authResults'
import { parseFlags, tagKeywordsOf } from '@peregrine/core/tags'
import { recipientsText } from '../migrations/008_fts_recipients'
import { listAttachments } from './attachmentsRepo'

interface MessageRow {
  id: string
  account_id: string
  folder_id: string
  uid: number
  message_id_header: string | null
  in_reply_to: string | null
  references_header: string | null
  subject: string | null
  from_address: string | null
  from_name: string | null
  to_addresses: string | null
  cc_addresses: string | null
  bcc_addresses: string | null
  date: string | null
  is_read: number
  is_flagged: number
  has_attachments: number
  preview_text: string | null
  flags: string | null
  body_text: string | null
  body_html: string | null
  headers_json: string | null
  size_bytes: number | null
  synced_fully: number
  snoozed_until: number | null
  pending_move_to: string | null
}

function parseAddresses(json: string | null): EmailAddress[] {
  if (!json) return []
  return JSON.parse(json) as EmailAddress[]
}

interface ParsedAddressList {
  value?: Array<{ name?: string; address?: string }>
}

/**
 * Digs Reply-To out of the stored header blob.
 *
 * It is not worth a column of its own. It is read when a message is displayed and never
 * queried. But it does matter: a Reply-To pointing at a different domain than the sender is
 * how a reply gets diverted, and it is invisible until the reply has already been written.
 */
export function parseReplyTo(headersJson: string | null): EmailAddress[] {
  if (!headersJson) return []
  try {
    const headers = JSON.parse(headersJson) as Record<string, unknown>
    const replyTo = (headers['reply-to'] ?? headers['replyTo']) as
      | ParsedAddressList
      | string
      | undefined
    if (!replyTo) return []
    if (typeof replyTo === 'string') return [{ name: '', address: replyTo.trim() }]
    return (replyTo.value ?? [])
      .filter((entry) => entry.address)
      .map((entry) => ({ name: entry.name ?? '', address: entry.address as string }))
  } catch {
    return []
  }
}

function toSummary(row: MessageRow): MessageSummary {
  return {
    id: row.id,
    accountId: row.account_id,
    folderId: row.folder_id,
    uid: row.uid,
    subject: row.subject ?? '',
    fromName: row.from_name ?? '',
    fromAddress: row.from_address ?? '',
    to: parseAddresses(row.to_addresses),
    messageIdHeader: row.message_id_header,
    inReplyTo: row.in_reply_to,
    referencesHeader: row.references_header,
    date: row.date ?? '',
    isRead: row.is_read === 1,
    isFlagged: row.is_flagged === 1,
    hasAttachments: row.has_attachments === 1,
    previewText: row.preview_text ?? '',
    sizeBytes: row.size_bytes ?? 0,
    tagKeywords: tagKeywordsOf(parseFlags(row.flags)),
    // A time that has passed is not a snooze any more; reporting it would show a reminder
    // badge on a message that is back in the list.
    snoozedUntil: row.snoozed_until && row.snoozed_until > Date.now() ? row.snoozed_until : null,
    pendingMoveTo: row.pending_move_to
  }
}

/** Pulls Authentication-Results out of the stored header blob; absent means "not checked". */
export function parseAuthResultsHeader(headersJson: string | null): AuthResults {
  if (!headersJson) return parseAuthenticationResults(null)
  try {
    const headers = JSON.parse(headersJson) as Record<string, unknown>
    const raw = headers['authentication-results']
    // Several relays each append one; mailparser hands those over as an array.
    const header = Array.isArray(raw) ? raw.join('\n') : typeof raw === 'string' ? raw : null
    return parseAuthenticationResults(header)
  } catch {
    return parseAuthenticationResults(null)
  }
}

/** Reads the spam verdict the delivering server left in the headers; null means none did. */
export function parseSpamHeaders(headersJson: string | null): SpamAssessment | null {
  if (!headersJson) return null
  try {
    return assessSpam(JSON.parse(headersJson) as Record<string, unknown>)
  } catch {
    return null
  }
}

async function toDetail(db: SqlDb, row: MessageRow): Promise<MessageDetail> {
  return {
    id: row.id,
    accountId: row.account_id,
    folderId: row.folder_id,
    uid: row.uid,
    subject: row.subject ?? '',
    from: row.from_address ? [{ name: row.from_name ?? '', address: row.from_address }] : [],
    to: parseAddresses(row.to_addresses),
    cc: parseAddresses(row.cc_addresses),
    bcc: parseAddresses(row.bcc_addresses),
    replyTo: parseReplyTo(row.headers_json),
    authResults: parseAuthResultsHeader(row.headers_json),
    spam: parseSpamHeaders(row.headers_json),
    date: row.date ?? '',
    messageIdHeader: row.message_id_header,
    inReplyTo: row.in_reply_to,
    referencesHeader: row.references_header,
    textBody: row.body_text,
    htmlBody: row.body_html,
    attachments: await listAttachments(db, row.id),
    pgpStatus: 'none',
    pendingMoveTo: row.pending_move_to
  }
}

/**
 * The sort keys, written so they can never be NULL.
 *
 * That is not cosmetic. Paging compares the sort key of the last row seen against the rows
 * that follow, and any comparison involving NULL is neither true nor false. A single message
 * without a subject would quietly fall out of the list, and nothing would say so. Wrapping
 * each key removes the case entirely.
 *
 * The substitutes are chosen to keep the order SQLite already produced: an empty string and a
 * zero sort where NULL used to, which is last under DESC and first under ASC. Exactly where
 * SQLite puts NULLs.
 *
 * Every expression here has a matching index (migration 017); changing one without the other
 * turns the sort back into a full scan.
 */
const SORT_EXPRESSIONS: Record<MessageSort['field'], string> = {
  date: "COALESCE(date, '')",
  subject: "COALESCE(subject, '') COLLATE NOCASE",
  from: "COALESCE(NULLIF(from_name, ''), from_address, '') COLLATE NOCASE",
  size: 'COALESCE(size_bytes, 0)'
}

const DEFAULT_SORT: MessageSort = { field: 'date', direction: 'desc' }

function sortExpression(sort: MessageSort): string {
  return SORT_EXPRESSIONS[sort.field] ?? SORT_EXPRESSIONS.date
}

/**
 * Exported for tests: the ORDER BY clause, with `rowid` as the tie-breaker.
 *
 * `rowid` rather than `uid`, because a unified view spans folders and a uid is only unique
 * within one. Two messages from different accounts can share it, and a tie-breaker that
 * ties is not one. Both parts run in the same direction so that one row-value comparison can
 * express "everything after this row".
 */
export function buildOrderBy(sort: MessageSort): string {
  const direction = sort.direction === 'asc' ? 'ASC' : 'DESC'
  return `${sortExpression(sort)} ${direction}, m.rowid ${direction}`
}

/** Exported for tests: the WHERE fragment appended for the quick filters. */
export function buildFilterSql(filter: MessageListFilter | undefined): string {
  const clauses: string[] = []
  if (filter?.unreadOnly) clauses.push('is_read = 0')
  if (filter?.flaggedOnly) clauses.push('is_flagged = 1')
  if (filter?.attachmentsOnly) clauses.push('has_attachments = 1')
  // Flags are stored as a JSON array, so a tag is matched as a fully quoted element. The
  // quotes are what make it exact: without them "Projekt" would also match "ProjektX".
  if (filter?.tagKeyword) clauses.push(`flags LIKE '%"' || ? || '"%'`)
  return clauses.length > 0 ? ` AND ${clauses.join(' AND ')}` : ''
}

/** The values `buildFilterSql` leaves as placeholders, in the same order. */
export function filterParams(filter: MessageListFilter | undefined): string[] {
  return filter?.tagKeyword ? [filter.tagKeyword] : []
}

function folderPlaceholders(folderIds: string[]): string {
  return folderIds.map(() => '?').join(', ')
}

/**
 * What a page cursor carries.
 *
 * `total` rides along so the count is computed once per result set instead of once per page.
 * Counting is a second full pass over the same rows; on a folder with a hundred thousand
 * messages it costs as much as the page itself, and the answer cannot change between two
 * pages of the same list anyway.
 *
 * `key` is the sort value and rowid of the last row handed out, which is what makes the next
 * page a lookup rather than a walk: `OFFSET 50000` asks SQLite to step over fifty thousand
 * rows and throw them away, while a key comparison starts where the previous page ended.
 *
 * `sort` is stored so a cursor cannot outlive the ordering it was made for. Re-sorting while
 * scrolled down would otherwise continue from a key that means nothing in the new order.
 */
export interface PageCursor {
  total: number
  key: [string | number, number]
  sort: string
}

function sortSignature(sort: MessageSort): string {
  return `${sort.field}:${sort.direction}`
}

export function encodeCursor(cursor: PageCursor): string {
  return JSON.stringify(cursor)
}

/** Returns null for anything unusable, which simply starts the list from the top. */
export function decodeCursor(raw: string | undefined, sort: MessageSort): PageCursor | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<PageCursor>
    if (typeof parsed.total !== 'number' || !Array.isArray(parsed.key)) return null
    if (parsed.key.length !== 2 || typeof parsed.key[1] !== 'number') return null
    if (parsed.sort !== sortSignature(sort)) return null
    return { total: parsed.total, key: [parsed.key[0], parsed.key[1]], sort: parsed.sort }
  } catch {
    return null
  }
}

/**
 * Exported for tests: "everything that comes after this row" in the current order.
 *
 * A row-value comparison rather than the expanded form. SQLite compares `(a, b) < (?, ?)`
 * element by element, which is precisely the rule the ORDER BY uses. Written out by hand it
 * is three clauses and an easy place to lose or repeat a row at a page boundary.
 */
export function buildKeysetSql(
  sort: MessageSort,
  cursor: PageCursor | null
): { sql: string; params: (string | number)[] } {
  if (!cursor) return { sql: '', params: [] }
  const comparison = sort.direction === 'asc' ? '>' : '<'
  return {
    sql: ` AND (${sortExpression(sort)}, m.rowid) ${comparison} (?, ?)`,
    params: [cursor.key[0], cursor.key[1]]
  }
}

/**
 * Expiry needs no job.
 *
 * The comparison is against the current time rather than a flag someone has to clear, so a
 * message comes back on the next read. Also after the application was closed over the
 * moment it was due.
 */
export function buildSnoozeSql(mode: SnoozeMode): { sql: string; params: number[] } {
  if (mode === 'all') return { sql: '', params: [] }
  const now = Date.now()
  return mode === 'only'
    ? { sql: ' AND m.snoozed_until > ?', params: [now] }
    : { sql: ' AND (m.snoozed_until IS NULL OR m.snoozed_until <= ?)', params: [now] }
}

/**
 * How full a folder has to be, in pages, before reading folders separately pays off.
 *
 * Ten was measured, not guessed. The two forms below cost different things: reading per folder
 * costs roughly one index seek per folder no matter how large it is, while one query over all
 * of them costs a sort of every matching row. So the crossover sits at a number of rows *per
 * folder*, and it turned out to be the same one whether there were 4 folders or 95:
 *
 * | Zeilen je Ordner | 4 Ordner | 20 Ordner | 95 Ordner |
 * |---|---|---|---|
 * | 200 | IN 1,1 / je 1,2 | IN 2,1 / je 4,0 | IN 6,5 / je 18,7 |
 * | 1000 | IN 2,7 / **je 1,1** | IN 6,4 / **je 4,1** | IN 49,9 / **je 19,6** |
 * | 5000 | IN 17,1 / **je 1,1** | IN 60,3 / **je 4,0** | IN 233,1 / **je 20,9** |
 *
 * Ten pages of 50 puts the switch at 500 rows per folder, between the two measured points, and
 * calls all fifteen of them correctly.
 */
export const MERGE_AT_PAGES_PER_FOLDER = 10

/**
 * Exported for tests: whether to read each folder on its own instead of all at once.
 *
 * This is not an optimisation that is always right, which is why it is a decision and not a
 * rewrite. On the mailbox this was built against, 2571 messages spread over 95 folders, the
 * per-folder form is **3,6× slower**, because 95 index seeks cost more than sorting 2571 rows.
 * Shipping it unconditionally would have made the everyday case worse in the name of a
 * speed-up.
 */
export function shouldMergePerFolder(
  folderCount: number,
  totalCount: number,
  pageSize: number
): boolean {
  if (folderCount < 2) return false
  return totalCount > folderCount * pageSize * MERGE_AT_PAGES_PER_FOLDER
}

/**
 * Exported for tests: the page query, in one of its two forms.
 *
 * `folder_id IN (?, ?, ?)` is the obvious way to read several folders at once, and for a
 * mailbox of ordinary size it is also the fastest. But SQLite picks exactly one index for such
 * a query and uses only its `folder_id` prefix; several ranges of one index do not come out in
 * order, so the ORDER BY falls back to `USE TEMP B-TREE`. Every matching row of every folder
 * gets materialised and sorted, to hand back fifty. That is fine for a few thousand rows and
 * ruinous for a hundred thousand: 276 ms for the first page.
 *
 * Read per folder and each part uses its own sort index and stops after `pageSize` rows. No
 * folder can contribute more than that to one page. The outer query merges the few hundred
 * candidates: **1,1 ms** for the same page, same rows, same order.
 *
 * The keyset clause belongs *inside* each part. Outside it would filter after the fact. Each
 * folder would hand up its own first fifty rows again on every page, the merge would drop them
 * all, and page two would come back empty while rows were left behind.
 */
export function buildPageSql(
  folderIds: string[],
  sort: MessageSort,
  clauses: string,
  keysetSql: string,
  merge: boolean
): string {
  const projection = `m.*, ${sortExpression(sort)} AS sort_key, m.rowid AS row_id`
  const orderBy = buildOrderBy(sort)

  if (!merge) {
    return `SELECT ${projection} FROM messages m
       WHERE m.folder_id IN (${folderPlaceholders(folderIds)})${clauses}${keysetSql}
       ORDER BY ${orderBy} LIMIT ?`
  }

  const part = `SELECT * FROM (SELECT ${projection} FROM messages m
       WHERE m.folder_id = ?${clauses}${keysetSql}
       ORDER BY ${orderBy} LIMIT ?)`
  // The outer ORDER BY sorts the already-projected column, so the expression, COLLATE and
  // all, has to be repeated here rather than referring to `m`, which no longer exists.
  const direction = sort.direction === 'asc' ? 'ASC' : 'DESC'
  const collate = sortExpression(sort).includes('COLLATE NOCASE') ? ' COLLATE NOCASE' : ''
  return `SELECT * FROM (${folderIds.map(() => part).join(' UNION ALL ')})
     ORDER BY sort_key${collate} ${direction}, row_id ${direction} LIMIT ?`
}

export async function listMessagesPage(
  db: SqlDb,
  folderIds: string[],
  cursor: string | undefined,
  pageSize: number,
  filter?: MessageListFilter,
  sort: MessageSort = DEFAULT_SORT,
  query?: string,
  snooze: SnoozeMode = 'hide'
): Promise<MessageListPage> {
  if (folderIds.length === 0) return { items: [], nextCursor: null, totalCount: 0 }
  const search = buildSearchClause(query)
  if (search.matchesNothing) return { items: [], nextCursor: null, totalCount: 0 }

  const previous = decodeCursor(cursor, sort)
  const put = buildSnoozeSql(snooze)
  const keyset = buildKeysetSql(sort, previous)

  // Counted once for the whole list and carried forward: it cannot change between two pages of
  // the same result set, and counting is a second full pass over the same rows. It is worked
  // out before the page rather than after, because it is also what decides which shape of
  // query to run. And on every page but the first it is already in the cursor, for free.
  const totalCount = previous?.total ?? (await countMessages(db, folderIds, filter, query, snooze))
  const merge = shouldMergePerFolder(folderIds.length, totalCount, pageSize)

  const clauses = `${search.sql}${buildFilterSql(filter)}${put.sql}`
  /** The placeholders of one folder's part, in the order the SQL reads them. */
  const perFolder = (folderId: string): unknown[] => [
    folderId,
    ...search.params,
    ...filterParams(filter),
    ...put.params,
    ...keyset.params,
    pageSize + 1
  ]
  const params = merge
    ? [...folderIds.flatMap(perFolder), pageSize + 1]
    : [
        ...folderIds,
        ...search.params,
        ...filterParams(filter),
        ...put.params,
        ...keyset.params,
        pageSize + 1
      ]

  // The sort key and the rowid come back alongside the row, so the next cursor can be built
  // without recomputing the expression here. The database already knows what it sorted by.
  const rows = await db.all<
    MessageRow & {
      sort_key: string | number
      row_id: number
    }
  >(buildPageSql(folderIds, sort, clauses, keyset.sql, merge), ...params)

  const hasMore = rows.length > pageSize
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows
  const last = pageRows[pageRows.length - 1]

  return {
    items: pageRows.map(toSummary),
    nextCursor:
      hasMore && last
        ? encodeCursor({
            total: totalCount,
            key: [last.sort_key, last.row_id],
            sort: sortSignature(sort)
          })
        : null,
    totalCount
  }
}

export async function countMessages(
  db: SqlDb,
  folderIds: string[],
  filter?: MessageListFilter,
  query?: string,
  snooze: SnoozeMode = 'hide'
): Promise<number> {
  if (folderIds.length === 0) return 0
  const search = buildSearchClause(query)
  if (search.matchesNothing) return 0
  const put = buildSnoozeSql(snooze)
  const row = await db.get<{ count: number }>(
    `SELECT COUNT(*) AS count FROM messages m
     WHERE m.folder_id IN (${folderPlaceholders(folderIds)})${search.sql}${buildFilterSql(filter)}${put.sql}`,
    ...folderIds,
    ...search.params,
    ...filterParams(filter),
    ...put.params
  )
  return row!.count
}

export async function getMessageSummaryById(
  db: SqlDb,
  id: string
): Promise<MessageSummary | undefined> {
  const row = await db.get<MessageRow>('SELECT * FROM messages WHERE id = ?', id)
  return row ? toSummary(row) : undefined
}

export async function getMessageByUid(
  db: SqlDb,
  folderId: string,
  uid: number
): Promise<MessageDetail | undefined> {
  const row = await db.get<MessageRow>(
    'SELECT * FROM messages WHERE folder_id = ? AND uid = ?',
    folderId,
    uid
  )
  return row ? toDetail(db, row) : undefined
}

export interface UpsertEnvelopeInput {
  accountId: string
  folderId: string
  uid: number
  messageIdHeader: string | null
  inReplyTo: string | null
  referencesHeader: string | null
  subject: string
  fromName: string
  fromAddress: string
  to: EmailAddress[]
  cc: EmailAddress[]
  bcc: EmailAddress[]
  date: string
  isRead: boolean
  isFlagged: boolean
  hasAttachments: boolean
  previewText: string
  sizeBytes: number
  /** Every IMAP flag as reported by the server, tags included. */
  flags?: string[]
}

export interface UpsertEnvelopeResult {
  id: string
  isNew: boolean
}

export async function upsertEnvelope(
  db: SqlDb,
  input: UpsertEnvelopeInput
): Promise<UpsertEnvelopeResult> {
  // Whether the message is new is decided by looking first, so looking and writing are one step.
  // Two syncs of one folder overlapping would otherwise both report the same message as new,
  // and it would be announced twice.
  return db.transaction(async (tx) => {
    const existing = await tx.get<{ id: string }>(
      'SELECT id FROM messages WHERE folder_id = ? AND uid = ?',
      input.folderId,
      input.uid
    )

    const id = existing?.id ?? randomUUID()

    await tx.run(
      `INSERT INTO messages (
        id, account_id, folder_id, uid, message_id_header, in_reply_to, references_header,
        subject, from_name, from_address, to_addresses, cc_addresses, bcc_addresses, date,
        is_read, is_flagged, has_attachments, preview_text, size_bytes, recipients_text, flags
      ) VALUES (
        @id, @accountId, @folderId, @uid, @messageIdHeader, @inReplyTo, @referencesHeader,
        @subject, @fromName, @fromAddress, @to, @cc, @bcc, @date,
        @isRead, @isFlagged, @hasAttachments, @previewText, @sizeBytes, @recipientsText, @flags
      )
      ON CONFLICT(folder_id, uid) DO UPDATE SET
        is_read = excluded.is_read,
        is_flagged = excluded.is_flagged,
        -- Tags may have been set in another client since the last sync, so the server's flag
        -- list wins over what is stored here.
        flags = excluded.flags`,
      {
        id,
        accountId: input.accountId,
        folderId: input.folderId,
        uid: input.uid,
        messageIdHeader: input.messageIdHeader,
        inReplyTo: input.inReplyTo,
        referencesHeader: input.referencesHeader,
        subject: input.subject,
        fromName: input.fromName,
        fromAddress: input.fromAddress,
        to: JSON.stringify(input.to),
        cc: JSON.stringify(input.cc),
        bcc: JSON.stringify(input.bcc),
        date: input.date,
        isRead: input.isRead ? 1 : 0,
        isFlagged: input.isFlagged ? 1 : 0,
        hasAttachments: input.hasAttachments ? 1 : 0,
        previewText: input.previewText,
        sizeBytes: input.sizeBytes,
        recipientsText: recipientsText(input.to, input.cc),
        flags: JSON.stringify(input.flags ?? [])
      }
    )

    return { id, isNew: !existing }
  })
}

/** Runs one statement for each item, as a single unit: either every row changes or none does. */
async function runForEach<T>(
  db: SqlDb,
  sql: string,
  items: T[],
  paramsOf: (item: T) => unknown[]
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const item of items) await tx.run(sql, ...paramsOf(item))
  })
}

export async function setMessagesFlagged(
  db: SqlDb,
  folderId: string,
  uids: number[],
  flagged: boolean
): Promise<void> {
  await runForEach(
    db,
    'UPDATE messages SET is_flagged = ? WHERE folder_id = ? AND uid = ?',
    uids,
    (uid) => [flagged ? 1 : 0, folderId, uid]
  )
}

export async function updateMessageBody(
  db: SqlDb,
  messageId: string,
  textBody: string | null,
  htmlBody: string | null,
  headersJson: string
): Promise<void> {
  await db.run(
    'UPDATE messages SET body_text = ?, body_html = ?, headers_json = ?, synced_fully = 1 WHERE id = ?',
    textBody,
    htmlBody,
    headersJson,
    messageId
  )
}

/**
 * Stores the untouched source of a PGP message and marks it as fetched.
 *
 * No plaintext is written: an encrypted message stays encrypted in the database, and a signed
 * one keeps the exact bytes its signature covers. Both are worked out again on every read.
 *
 * The envelope headers are stored alongside, because `replyTo` and `authResults` are read from
 * them. They travelled in the clear anyway. Keeping them out would not have protected
 * anything, it only left the Reply-To warning and the SPF/DKIM/DMARC line switched off on
 * exactly the messages that look most trustworthy.
 */
export async function storePgpSource(
  db: SqlDb,
  messageId: string,
  rawSource: string,
  headersJson: string
): Promise<void> {
  await db.run(
    'UPDATE messages SET raw_source = ?, headers_json = ?, synced_fully = 1 WHERE id = ?',
    rawSource,
    headersJson,
    messageId
  )
}

/**
 * The source of a stored PGP message whose envelope headers were never kept. `null` for
 * everything else.
 *
 * Such messages count as fully fetched, so they never pass the fetch path again and would keep
 * their Reply-To warning and SPF/DKIM/DMARC line switched off forever. Filling them in when
 * they are next opened costs one parse each, spread over the messages actually read; a
 * migration would parse every stored message at one startup, most of them never to be looked
 * at again.
 */
export async function pgpSourceMissingHeaders(
  db: SqlDb,
  messageId: string
): Promise<string | null> {
  const row = await db.get<{ s: string }>(
    'SELECT raw_source as s FROM messages WHERE id = ? AND headers_json IS NULL AND raw_source IS NOT NULL',
    messageId
  )
  return row?.s ?? null
}

export async function setMessageHeaders(
  db: SqlDb,
  messageId: string,
  headersJson: string
): Promise<void> {
  await db.run('UPDATE messages SET headers_json = ? WHERE id = ?', headersJson, messageId)
}

export async function getMessageRawSource(db: SqlDb, messageId: string): Promise<string | null> {
  const row = await db.get<{ s: string | null }>(
    'SELECT raw_source as s FROM messages WHERE id = ?',
    messageId
  )
  return row?.s ?? null
}

/**
 * Whether the whole message including its attachments has been fetched. A body that was only
 * pulled in for the search index does not count. That one still needs the full fetch.
 */
export async function isMessageFullySynced(db: SqlDb, messageId: string): Promise<boolean> {
  const row = await db.get<{ s: number }>(
    'SELECT synced_fully as s FROM messages WHERE id = ?',
    messageId
  )
  return row?.s === 1
}

export interface BodyIndexCandidate {
  id: string
  uid: number
  folderId: string
  imapPath: string
  sizeBytes: number
}

/**
 * Messages whose body has never been read, newest first.
 *
 * Only the text is fetched for these, not the attachments, so `synced_fully` stays 0 and
 * opening such a message still runs the full fetch. Newest first because that is what a
 * search is most likely to be looking for while the backlog is still being worked through.
 */
export async function listMessagesNeedingBody(
  db: SqlDb,
  accountId: string,
  limit: number
): Promise<BodyIndexCandidate[]> {
  return db.all<BodyIndexCandidate>(
    `SELECT m.id as id, m.uid as uid, m.folder_id as folderId, f.imap_path as imapPath,
            COALESCE(m.size_bytes, 0) as sizeBytes
     FROM messages m
     JOIN folders f ON f.id = m.folder_id
     WHERE m.account_id = ? AND m.body_text IS NULL AND m.synced_fully = 0
     ORDER BY m.date DESC
     LIMIT ?`,
    accountId,
    limit
  )
}

/**
 * Stores the body text for the search index only.
 *
 * Deliberately leaves `synced_fully` at 0 and does not touch `body_html`: the attachments
 * have not been extracted yet, so opening the message must still take the full path.
 */
export async function indexMessageBody(
  db: SqlDb,
  messageId: string,
  bodyText: string,
  previewText: string
): Promise<void> {
  await db.run(
    `UPDATE messages SET body_text = ?, preview_text = COALESCE(NULLIF(preview_text, ''), ?)
     WHERE id = ?`,
    bodyText,
    previewText,
    messageId
  )
}

/** Marks a message as not worth retrying, so a permanently failing fetch cannot loop forever. */
export async function markBodyIndexFailed(db: SqlDb, messageId: string): Promise<void> {
  await db.run(`UPDATE messages SET body_text = '' WHERE id = ?`, messageId)
}

export async function setMessagesRead(
  db: SqlDb,
  folderId: string,
  uids: number[],
  read: boolean
): Promise<void> {
  await runForEach(
    db,
    'UPDATE messages SET is_read = ? WHERE folder_id = ? AND uid = ?',
    uids,
    (uid) => [read ? 1 : 0, folderId, uid]
  )
}

/** `until` in epoch milliseconds, or null to bring the messages back now. */
export async function setMessagesSnoozed(
  db: SqlDb,
  refs: Array<{ folderId: string; uid: number }>,
  until: number | null
): Promise<void> {
  await runForEach(
    db,
    'UPDATE messages SET snoozed_until = ? WHERE folder_id = ? AND uid = ?',
    refs,
    (ref) => [until, ref.folderId, ref.uid]
  )
}

/**
 * The next moment at which something comes back, or null when nothing is waiting.
 *
 * One number for the whole mailbox: the scheduler needs a single timer, not one per message.
 */
export async function nextSnoozeDue(db: SqlDb): Promise<number | null> {
  const row = await db.get<{ due: number | null }>(
    'SELECT MIN(snoozed_until) AS due FROM messages WHERE snoozed_until IS NOT NULL'
  )
  return row?.due ?? null
}

/** Messages whose moment has come, for the reminder that announces them. */
export async function listDueSnoozed(db: SqlDb, until: number): Promise<MessageSummary[]> {
  const rows = await db.all<MessageRow>(
    'SELECT * FROM messages WHERE snoozed_until <= ? ORDER BY snoozed_until',
    until
  )
  return rows.map(toSummary)
}

/**
 * Clears the reminders that have been dealt with.
 *
 * Without this the value would stay behind for good, and every scheduler round would find
 * the same overdue messages again. A timer that fires immediately, forever. The lists do not
 * need it, they already treat a time in the past as no snooze at all.
 */
export async function clearExpiredSnoozes(db: SqlDb, until: number): Promise<void> {
  await db.run(
    'UPDATE messages SET snoozed_until = NULL WHERE snoozed_until IS NOT NULL AND snoozed_until <= ?',
    until
  )
}

export async function markFolderRead(db: SqlDb, folderId: string): Promise<void> {
  await db.run('UPDATE messages SET is_read = 1 WHERE folder_id = ? AND is_read = 0', folderId)
}

export async function deleteMessages(db: SqlDb, folderId: string, uids: number[]): Promise<void> {
  await runForEach(db, 'DELETE FROM messages WHERE folder_id = ? AND uid = ?', uids, (uid) => [
    folderId,
    uid
  ])
}

/**
 * Notes that these messages are to be moved as soon as there is a connection.
 *
 * `targetFolderId` of null takes the note back. Used when the move has run, when it was given
 * up on, and when a later action makes it moot. A note that outlives its queued action would
 * promise a move that is never coming.
 */
export async function setPendingMove(
  db: SqlDb,
  folderId: string,
  uids: number[],
  targetFolderId: string | null
): Promise<void> {
  await runForEach(
    db,
    'UPDATE messages SET pending_move_to = ? WHERE folder_id = ? AND uid = ?',
    uids,
    (uid) => [targetFolderId, folderId, uid]
  )
}

/** The stored flag list of one message as JSON, or null when it has none or is not stored. */
export async function getMessageFlagsJson(
  db: SqlDb,
  folderId: string,
  uid: number
): Promise<string | null> {
  const row = await db.get<{ flags: string | null }>(
    'SELECT flags FROM messages WHERE folder_id = ? AND uid = ?',
    folderId,
    uid
  )
  return row?.flags ?? null
}

/**
 * Adds or removes one keyword in the stored flag list.
 *
 * Read and written back in one step. A tag set on two messages at once is two calls, but two
 * tags set on one message would otherwise each start from the same list and the second would
 * undo the first.
 */
export async function setMessageKeyword(
  db: SqlDb,
  folderId: string,
  uid: number,
  keyword: string,
  present: boolean
): Promise<void> {
  await db.transaction(async (tx) => {
    const stored = await getMessageFlagsJson(tx, folderId, uid)
    const flags = new Set<string>(stored ? (JSON.parse(stored) as string[]) : [])
    if (present) flags.add(keyword)
    else flags.delete(keyword)
    await tx.run(
      'UPDATE messages SET flags = ? WHERE folder_id = ? AND uid = ?',
      JSON.stringify([...flags]),
      folderId,
      uid
    )
  })
}

/**
 * Brings the already-known messages of a folder up to date, cheaply.
 *
 * The incremental fetch never sees them, so read state, stars and tags changed in another
 * client would go unnoticed. And messages deleted elsewhere would linger. The flags-only list
 * from the same selection answers both questions at once: what it contains is what still
 * exists, and with which flags.
 */
export async function reconcileFlags(
  db: SqlDb,
  folderId: string,
  remote: { uid: number; flags: string[] }[]
): Promise<void> {
  const remoteByUid = new Map(remote.map((row) => [row.uid, row.flags]))

  await db.transaction(async (tx) => {
    const local = await tx.all<{
      uid: number
      isRead: number
      isFlagged: number
      flags: string | null
    }>(
      'SELECT uid, is_read as isRead, is_flagged as isFlagged, flags FROM messages WHERE folder_id = ?',
      folderId
    )

    for (const row of local) {
      const flags = remoteByUid.get(row.uid)
      if (!flags) {
        // Gone from the server. Moved or deleted in another client.
        await tx.run('DELETE FROM messages WHERE folder_id = ? AND uid = ?', folderId, row.uid)
        continue
      }
      const isRead = flags.includes('\\Seen') ? 1 : 0
      const isFlagged = flags.includes('\\Flagged') ? 1 : 0
      const serialized = JSON.stringify(flags)
      // Only write when something actually differs: an untouched mailbox should not produce
      // thousands of no-op updates, each of which would fire the full-text triggers.
      if (row.isRead !== isRead || row.isFlagged !== isFlagged || row.flags !== serialized) {
        await tx.run(
          'UPDATE messages SET is_read = ?, is_flagged = ?, flags = ? WHERE folder_id = ? AND uid = ?',
          isRead,
          isFlagged,
          serialized,
          folderId,
          row.uid
        )
      }
    }
  })
}

/** The uids of the unread messages of a folder. */
export async function listUnreadUids(db: SqlDb, folderId: string): Promise<number[]> {
  const rows = await db.all<{ uid: number }>(
    'SELECT uid FROM messages WHERE folder_id = ? AND is_read = 0',
    folderId
  )
  return rows.map((row) => row.uid)
}

/** The uids of every message of a folder. */
export async function listFolderUids(db: SqlDb, folderId: string): Promise<number[]> {
  const rows = await db.all<{ uid: number }>('SELECT uid FROM messages WHERE folder_id = ?', folderId)
  return rows.map((row) => row.uid)
}

/** Every message of a folder as its id and uid, newest first. */
export async function listFolderMessageRefs(
  db: SqlDb,
  folderId: string
): Promise<Array<{ id: string; uid: number }>> {
  return db.all<{ id: string; uid: number }>(
    'SELECT id, uid FROM messages WHERE folder_id = ? ORDER BY date DESC',
    folderId
  )
}

/** Exported for tests: turns free text into a prefix-matching FTS5 query. */
export function buildFtsMatchQuery(rawQuery: string): string {
  const terms = rawQuery
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replace(/"/g, '""')}"*`)
  return terms.join(' ')
}

export interface SearchResultRow extends MessageSummary {
  folderDisplayName: string
}

/**
 * Structured operators are matched with plain SQL rather than full-text column filters: the
 * FTS layout can change (recipients being added to the index, for instance) without the search
 * syntax having to follow, and operators then work on messages whose body was never fetched.
 */
function buildStructuredWhere(query: ParsedSearchQuery): { sql: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []

  if (query.from) {
    clauses.push('(m.from_address LIKE ? OR m.from_name LIKE ?)')
    params.push(`%${query.from}%`, `%${query.from}%`)
  }
  if (query.to) {
    clauses.push('(m.to_addresses LIKE ? OR m.cc_addresses LIKE ?)')
    params.push(`%${query.to}%`, `%${query.to}%`)
  }
  if (query.subject) {
    clauses.push('m.subject LIKE ?')
    params.push(`%${query.subject}%`)
  }
  if (query.hasAttachment) clauses.push('m.has_attachments = 1')
  if (query.isUnread) clauses.push('m.is_read = 0')
  if (query.isFlagged) clauses.push('m.is_flagged = 1')
  if (query.after) {
    clauses.push('m.date >= ?')
    params.push(query.after)
  }
  if (query.before) {
    clauses.push('m.date < ?')
    params.push(query.before)
  }

  return { sql: clauses.length > 0 ? ` AND ${clauses.join(' AND ')}` : '', params }
}

export interface SearchClause {
  /** Appended to a WHERE that already has a condition; empty when there is nothing to search. */
  sql: string
  params: unknown[]
  /** The query says something, but nothing can satisfy it. The caller returns no rows. */
  matchesNothing: boolean
}

/**
 * Turns a search query into a condition the message list can carry. That is what makes a
 * saved search a folder rather than a second kind of list.
 *
 * The full-text part is a `rowid IN (SELECT …)` subquery rather than a join, so the outer
 * query keeps exactly one table. A join would put `subject` in the statement twice, and every
 * ORDER BY and filter clause would have to be qualified to say which one it means.
 *
 * Exported for tests.
 */
export function buildSearchClause(rawQuery: string | undefined): SearchClause {
  const trimmed = rawQuery?.trim()
  if (!trimmed) return { sql: '', params: [], matchesNothing: false }

  const parsed = parseSearchQuery(trimmed)
  const matchQuery = buildFtsMatchQuery(parsed.text)
  // A query that is neither text nor an operator, a lone quote say, must not quietly turn
  // into "everything", which is the one answer a saved search never means.
  if (!matchQuery && !hasStructuredFilters(parsed)) {
    return { sql: '', params: [], matchesNothing: true }
  }

  const structured = buildStructuredWhere(parsed)
  const fts = matchQuery
    ? ' AND m.rowid IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)'
    : ''
  return {
    sql: `${fts}${structured.sql}`,
    params: matchQuery ? [matchQuery, ...structured.params] : structured.params,
    matchesNothing: false
  }
}

export async function searchMessages(
  db: SqlDb,
  accountIds: string[] | undefined,
  query: string,
  limit: number
): Promise<SearchResultRow[]> {
  if (accountIds && accountIds.length === 0) return []

  const parsed = parseSearchQuery(query)
  const matchQuery = buildFtsMatchQuery(parsed.text)
  if (!matchQuery && !hasStructuredFilters(parsed)) return []

  // An empty/undefined account list searches every account. That is the unified search case.
  const accountFilter = accountIds
    ? ` AND m.account_id IN (${accountIds.map(() => '?').join(', ')})`
    : ''
  const structured = buildStructuredWhere(parsed)

  // With free text present the FTS table drives the query and ranks the hits; a query made up
  // purely of operators skips the index entirely and reads the messages table directly.
  const sql = matchQuery
    ? `SELECT m.*, f.display_name as folder_display_name FROM messages_fts
       JOIN messages m ON m.rowid = messages_fts.rowid
       JOIN folders f ON f.id = m.folder_id
       WHERE messages_fts MATCH ?${accountFilter}${structured.sql}
       ORDER BY rank
       LIMIT ?`
    : `SELECT m.*, f.display_name as folder_display_name FROM messages m
       JOIN folders f ON f.id = m.folder_id
       WHERE 1 = 1${accountFilter}${structured.sql}
       ORDER BY m.date DESC
       LIMIT ?`

  const params = matchQuery
    ? [matchQuery, ...(accountIds ?? []), ...structured.params, limit]
    : [...(accountIds ?? []), ...structured.params, limit]

  const rows = await db.all<MessageRow & { folder_display_name: string }>(sql, ...params)

  return rows.map((row) => ({ ...toSummary(row), folderDisplayName: row.folder_display_name }))
}

export async function moveMessages(
  db: SqlDb,
  sourceFolderId: string,
  targetFolderId: string,
  uids: number[]
): Promise<void> {
  await runForEach(
    db,
    'UPDATE messages SET folder_id = ? WHERE folder_id = ? AND uid = ?',
    uids,
    (uid) => [targetFolderId, sourceFolderId, uid]
  )
}
