import type { AuthResults } from './authResults'
import type { SpamAssessment } from './spamScore'
import type { ImportableAccount } from './thunderbirdPrefs'
import type { DiscoveredConfig } from './autoconfig'

export type SecureMode = 'tls' | 'starttls' | 'none'

export interface AccountSummary {
  id: string
  displayName: string
  emailAddress: string
  imapHost: string
  imapPort: number
  imapSecure: SecureMode
  imapUsername: string
  smtpHost: string
  smtpPort: number
  smtpSecure: SecureMode
  smtpUsername: string
  authType: 'password' | 'oauth2'
  sortOrder: number
  signature: string
  color: string
  encryptByDefault: boolean
}

export type ThemeMode = 'system' | 'light' | 'dark'
export type AccentColor =
  | 'blue'
  | 'indigo'
  | 'violet'
  | 'magenta'
  | 'rose'
  | 'red'
  | 'amber'
  | 'lime'
  | 'green'
  | 'teal'
  | 'cyan'
  | 'slate'
  /** Uses `accentCustom` instead of a preset. */
  | 'custom'
export type Density = 'comfortable' | 'cozy' | 'compact'
/** How dates are written in the message list. */
export type DateFormat = 'relative' | 'short' | 'long' | 'iso'
/** Where the reading pane sits relative to the message list. */
export type ReaderPosition = 'bottom' | 'right' | 'hidden'
export type MessageSortField = 'date' | 'subject' | 'from' | 'size'
export type SortDirection = 'asc' | 'desc'

/**
 * How to tell which build is actually running.
 *
 * There was nothing for this before. Anyone reporting a fault could not say which version
 * showed it, and two installations could not be told apart. The values come from the main
 * process because only it knows them. The renderer has neither `app.getVersion()` nor
 * `process.versions`.
 */
export interface AppVersionInfo {
  /** The version from package.json, the same one the installer carries. */
  version: string
  electron: string
  chromium: string
  node: string
  /**
   * False during development. The difference matters, because only the packaged build reads
   * its files from the asar archive, and a fault that only occurs there cannot otherwise be
   * placed.
   */
  packaged: boolean
}

export interface AppSettings {
  theme: ThemeMode
  accentColor: AccentColor
  density: Density
  /** 'system' follows the OS/browser locale, otherwise an explicit i18n language code. */
  language: string
  notificationsEnabled: boolean
  /** Sender and subject in the notification. Off leaves only "new mail" plus the account. */
  notificationPreview: boolean
  /** Accounts that stay silent, as a JSON array of ids. Opt-out, so a new account notifies. */
  notificationMutedAccounts: string
  /** `HH:MM`; both empty switches quiet hours off. May run across midnight. */
  notificationQuietFrom: string
  notificationQuietTo: string
  /** Hour at which the daily list rolls over; 4 means someone up at 1 a.m. still has yesterday. */
  dayStartHour: number
  /** Messages carrying this IMAP keyword appear on the daily list. Empty switches it off. */
  dailyTagKeyword: string

  readerPosition: ReaderPosition
  /** Persisted splitter positions in px so the layout survives restarts. */
  sidebarWidth: number
  readerPaneHeight: number
  readerPaneWidth: number
  /** Groups the special-use folders of every account under one virtual tree node. */
  unifiedFolders: boolean
  /** Delay before an opened message is flagged \Seen. -1 disables auto-marking entirely. */
  markReadDelayMs: number
  blockRemoteImages: boolean
  showPreviewText: boolean
  /**
   * Hides everything except the subject and tightens the rows.
   *
   * Not another density step but a different question. Density governs spacing, this governs
   * what is there at all. Someone skimming for who has written needs neither sender nor date
   * nor size, and without them a row fits into the height of its own type.
   */
  subjectOnly: boolean
  sortField: MessageSortField
  sortDirection: SortDirection
  /** Groups replies under the message they answer. */
  threadView: boolean
  /** Background refresh of all folders, in minutes. 0 switches it off. */
  syncIntervalMinutes: number
  /** Signs outgoing mail with the account key when one exists. */
  signByDefault: boolean
  /**
   * Talks to mail servers with the client built into Peregrine instead of imapflow. Takes effect
   * when an account next connects.
   */
  experimentalImapClient: boolean

  /** User-defined surface and text colours as JSON; empty object means the built-in scheme. */
  customTheme: string
  /** Free accent colour as `#rrggbb`; only in effect while accentColor is 'custom'. */
  accentCustom: string
  /** Scales every font size in the app. 1 is the default; 0.85 to 1.4 are offered. */
  fontScale: number
  dateFormat: DateFormat
  /** Visible columns of the message list as a JSON array; the order is the display order. */
  messageColumns: string
  /** Column widths as a JSON object keyed by column id; the subject takes what is left. */
  columnWidths: string
  /** Stored search queries shown as folders in the sidebar, as a JSON array. */
  savedSearches: string

  /** Points out links and senders that do not read the way they resolve. */
  warnSuspiciousLinks: boolean
  /** Asks before opening any external link, not just the suspicious ones. */
  confirmAllLinks: boolean
  /** Warns about attachments whose type is commonly used to deliver programs. */
  warnRiskyAttachments: boolean
  /** Keyboard shortcuts as JSON, keyed by action; missing actions use the defaults. */
  shortcuts: string
  /** Seconds a sent message waits before it actually leaves. 0 sends immediately. */
  undoSendSeconds: number
  /** Locks an encrypted profile after this many idle minutes. 0 switches it off. */
  autoLockMinutes: number
}

export interface AccountUpdateInput {
  accountId: string
  displayName?: string
  signature?: string
  color?: string
  encryptByDefault?: boolean
  imapHost?: string
  imapPort?: number
  imapSecure?: SecureMode
  imapUsername?: string
  smtpHost?: string
  smtpPort?: number
  smtpSecure?: SecureMode
  smtpUsername?: string
  /** Only sent when the user actually re-enters credentials; never echoed back to the renderer. */
  imapPassword?: string
  smtpPassword?: string
}

export interface AccountCreateInput {
  displayName: string
  emailAddress: string
  imapHost: string
  imapPort: number
  imapSecure: SecureMode
  imapUsername: string
  imapPassword: string
  smtpHost: string
  smtpPort: number
  smtpSecure: SecureMode
  smtpUsername: string
  smtpPassword: string
}

/** A profile as the unlock screen needs to know it. Never the salt or verifier. */
export interface ProfileSummary {
  id: string
  name: string
  /** Whether a password is required; the password itself never leaves the main process. */
  encrypted: boolean
}

export type ProfileUnlockResult =
  | { ok: true }
  | { ok: false; reason: 'wrongPassword' | 'notFound' | 'openFailed' }

/** Result of looking for a Thunderbird installation. */
export interface ThunderbirdScanResult {
  /** Null when no installation was found. */
  profilePath: string | null
  accounts: ImportableAccount[]
}

/** A message as it arrived, for inspecting rather than reading. */
export interface MessageSourceResult {
  source: string
  /** Header lines in the order they appear, unfolded; repeats are kept. */
  headers: { name: string; value: string }[]
  sizeBytes: number
}

/** A colour-coded label, stored on the server as an IMAP keyword. */
export interface Tag {
  id: string
  name: string
  /** What the server actually stores; derived from the name and never changed afterwards. */
  keyword: string
  color: string
  sortOrder: number
}

/** A sender address under an account: several identities share one server connection. */
export interface Identity {
  id: string
  accountId: string
  displayName: string
  emailAddress: string
  signature: string
  /** The one a new message starts from; exactly one per account. */
  isDefault: boolean
  sortOrder: number
}

export interface IdentityInput {
  accountId: string
  displayName: string
  emailAddress: string
  signature: string
}

export interface ConnectionTestInput {
  imapHost: string
  imapPort: number
  imapSecure: SecureMode
  imapUsername: string
  imapPassword: string
  smtpHost: string
  smtpPort: number
  smtpSecure: SecureMode
  smtpUsername: string
  smtpPassword: string
}

export interface ConnectionTestResult {
  imapOk: boolean
  smtpOk: boolean
  imapError?: string
  smtpError?: string
}

export type SpecialUse = 'inbox' | 'sent' | 'drafts' | 'trash' | 'junk' | 'archive' | null

export interface FolderNode {
  id: string
  accountId: string
  imapPath: string
  displayName: string
  specialUse: SpecialUse
  parentId: string | null
  unreadCount: number
  totalCount: number
}

export interface EmailAddress {
  name: string
  address: string
}

/** A message a task was made from; kept loose, see the tasks migration. */
export interface TaskMessageLink {
  accountId: string
  folderId: string
  uid: number
  messageIdHeader: string | null
}

export interface TaskItem {
  id: string
  title: string
  /** The day it was ticked; an item ticked yesterday is open again today. */
  doneOn: string | null
}

export interface Task {
  id: string
  title: string
  notes: string
  /** Serialized rule, see `shared/recurrence.ts`. */
  recurrence: string
  startDay: string
  sortOrder: number
  link: TaskMessageLink | null
  items: TaskItem[]
}

/** One task as it appears on a particular day. */
export interface DailyTask extends Task {
  done: boolean
}

/**
 * A message that is on today's list because it carries the configured tag.
 *
 * Not stored as a task: the tag is the truth, and copying it into a row would leave a
 * second copy behind the moment the tag is removed elsewhere.
 */
export interface DailyMail {
  accountId: string
  folderId: string
  uid: number
  subject: string
  fromName: string
  fromAddress: string
  date: string
}

export interface DailyList {
  /** The day the list is for, as `YYYY-MM-DD`. */
  dayKey: string
  tasks: DailyTask[]
  mails: DailyMail[]
}

export interface TaskInput {
  title: string
  notes?: string
  recurrence?: string
  link?: TaskMessageLink | null
  items?: string[]
}

/** Where a set of server settings came from. Shown, because it says how much to trust it. */
export type DiscoverySource = 'provider' | 'wellKnown' | 'mozilla' | 'srv'

export type DiscoveryResult =
  | { found: false }
  | { found: true; source: DiscoverySource; config: DiscoveredConfig }

/**
 * How a listing treats messages that were put aside.
 *
 * 'hide' is what a folder shows, 'only' is the reminder list, 'all' is what a search does.
 * A message one is looking for should be found whether or not it is waiting to come back.
 */
export type SnoozeMode = 'hide' | 'only' | 'all'

export interface MessageSummary {
  id: string
  accountId: string
  folderId: string
  uid: number
  subject: string
  fromName: string
  fromAddress: string
  /** Recipients, so the list can show "→ recipient" in sent/drafts folders. */
  to: EmailAddress[]
  /** Threading headers, so the list can group a conversation without refetching. */
  messageIdHeader: string | null
  inReplyTo: string | null
  referencesHeader: string | null
  date: string
  isRead: boolean
  isFlagged: boolean
  hasAttachments: boolean
  previewText: string
  sizeBytes: number
  /** IMAP keywords on this message that are tags rather than system flags. */
  tagKeywords: string[]
  /** Epoch ms at which a message put aside comes back; null when it is not waiting. */
  snoozedUntil: number | null
  /**
   * Id of the folder this message is on its way to, once there is a connection again.
   *
   * It is still listed in its current folder, because that is still where it is. The server
   * has not been told anything yet. The list says where it is headed rather than hiding it:
   * a message in no folder at all cannot be found, corrected or acted on again.
   */
  pendingMoveTo: string | null
}

export interface SearchResultItem extends MessageSummary {
  folderDisplayName: string
}

export interface MessageListPage {
  items: MessageSummary[]
  nextCursor: string | null
  /** Number of messages matching the current folders/filter, for the list header. */
  totalCount: number
}

/** Identifies a single message across accounts, so bulk actions work in unified views. */
export interface MessageRef {
  accountId: string
  folderId: string
  uid: number
}

/** A folder to read messages from; a unified view simply passes several of them. */
export interface MessageListTarget {
  accountId: string
  folderId: string
}

export interface MessageListFilter {
  unreadOnly?: boolean
  /** IMAP keyword of a tag; only messages carrying it are listed. */
  tagKeyword?: string
  flaggedOnly?: boolean
  attachmentsOnly?: boolean
}

export interface MessageSort {
  field: MessageSortField
  direction: SortDirection
}

/**
 * Everything needed to put moved messages back where they came from. Built only when the
 * server reported the new UIDs (UIDPLUS); otherwise the action simply offers no undo.
 */
export interface UndoMoveEntry {
  accountId: string
  /** Where the messages are now. */
  folderId: string
  uids: number[]
  /** Where they came from. */
  targetFolderId: string
}

export interface MessageActionResult {
  movedCount: number
  undo: UndoMoveEntry[] | null
}

export interface AttachmentMeta {
  id: string
  filename: string
  contentType: string
  sizeBytes: number
  isInline: boolean
  contentId: string | null
}

export interface MessageDetail {
  id: string
  accountId: string
  folderId: string
  uid: number
  subject: string
  from: EmailAddress[]
  to: EmailAddress[]
  cc: EmailAddress[]
  bcc: EmailAddress[]
  /** Where a reply would actually go; empty when it is simply the sender. */
  replyTo: EmailAddress[]
  /** What the receiving server made of SPF/DKIM/DMARC, as far as it said so. */
  authResults: AuthResults
  /** What the delivering server's spam filter concluded, or null when none said. */
  spam: SpamAssessment | null
  date: string
  messageIdHeader: string | null
  inReplyTo: string | null
  referencesHeader: string | null
  textBody: string | null
  htmlBody: string | null
  attachments: AttachmentMeta[]
  pgpStatus: PgpStatus
  /** Id of the folder this message is on its way to; see `MessageSummary.pendingMoveTo`. */
  pendingMoveTo: string | null
}

export type PgpStatus =
  | 'none'
  | 'encrypted-verified'
  | 'encrypted-unverified'
  | 'encrypted-failed'
  /** Not encrypted, but carrying a PGP signature. */
  | 'signed-verified'
  | 'signed-unverified'
  | 'signed-invalid'

export interface PgpKeyInfo {
  fingerprint: string
  publicKeyArmored: string
}

/**
 * Where a contact's public key came from.
 *
 * The order is roughly the order of trust. 'wkd' means the domain that owns the address
 * published it; 'keyserver' means someone proved control of the address to
 * keys.openpgp.org; 'manual' means a person pasted it in and vouched for it themselves.
 */
export type ContactKeySource = 'wkd' | 'keyserver' | 'manual'

export interface ContactKeyInfo {
  contactId: string
  email: string
  fingerprint: string
  source: ContactKeySource
  /** The mailbox that was open when the key arrived; the key itself is shared. */
  discoveredForAccountId: string | null
  updatedAt: string | null
}

/**
 * One key in an account's ring.
 *
 * Only the active key signs and is handed to others; the rest stay because mail encrypted to
 * them stays encrypted to them, and old signatures can only be checked against the key that
 * made them.
 */
export interface AccountKeyInfo {
  fingerprint: string
  isActive: boolean
  createdAt: string
  /** Read from the key itself, so a warning cannot drift from what the key says. */
  expiresAt: string | null
  revoked: boolean
}

/**
 * Where a set of keys is being taken from.
 *
 * Thunderbird's rings are found by the app; a file is chosen by the user. Both end up in the
 * same mapping, so the distinction only has to survive as far as reading the bytes.
 */
export type KeyImportSource =
  | { kind: 'thunderbird'; profilePath?: string }
  | { kind: 'file'; path: string }

export interface KeyImportResult {
  fingerprint: string
  status: 'imported' | 'skipped' | 'failed'
  /** Account ids for a key of one's own, or the address a contact key was filed under. */
  targets: string[]
  /** Only on failure. `wrongPassphrase` is the one worth another try. */
  reason?: 'wrongPassphrase' | 'passphraseRequired' | 'notPrivate' | 'unreadable'
}

export interface Contact {
  id: string
  name: string
  email: string
  frequency: number
}

export type FilterConditionField =
  | 'from'
  | 'to'
  | 'cc'
  | 'subject'
  | 'body'
  | 'sizeBytes'
  | 'hasAttachment'
export type FilterOperator =
  | 'contains'
  | 'notContains'
  | 'equals'
  | 'startsWith'
  | 'endsWith'
  | 'regex'
  | 'greaterThan'
  | 'lessThan'
  | 'isTrue'
  | 'isFalse'
export type FilterMatchMode = 'all' | 'any'
export type FilterActionType = 'move' | 'markRead' | 'flag' | 'delete' | 'markUnread' | 'stop'

export interface FilterCondition {
  field: FilterConditionField
  operator: FilterOperator
  value: string
}

export interface FilterAction {
  type: FilterActionType
  targetFolderId?: string | null
}

export interface FilterRule {
  id: string
  accountId: string
  name: string
  /** 'all' = every condition must match, 'any' = at least one. */
  matchMode: FilterMatchMode
  conditions: FilterCondition[]
  actions: FilterAction[]
  enabled: boolean
  /** Lower runs first; a matching rule with a 'stop' action ends the chain. */
  priority: number
}

export interface FilterRuleInput {
  accountId: string
  name: string
  matchMode: FilterMatchMode
  conditions: FilterCondition[]
  actions: FilterAction[]
}

export interface ComposeAttachmentInput {
  filename: string
  path: string
}

export interface ComposeInput {
  accountId: string
  /** Which sender address to use; falls back to the account default when absent. */
  identityId?: string
  /** Bypasses the undo-send grace period; set when the delay has already elapsed. */
  sendNow?: boolean
  /** Epoch ms at which the message should go out; absent means now. */
  sendAt?: number
  to: EmailAddress[]
  cc: EmailAddress[]
  bcc: EmailAddress[]
  subject: string
  textBody: string
  htmlBody: string
  attachments: ComposeAttachmentInput[]
  inReplyTo?: string
  references?: string
  encrypt?: boolean
  /** Attaches a PGP signature without encrypting; independent of `encrypt`. */
  sign?: boolean
  /** UID of the draft this message was composed from; it is removed once the mail is sent. */
  draftUid?: number
}

/** What a compose window is seeded with, whether new, a reply, or a reopened draft. */
export interface ComposeSeed {
  accountId: string
  identityId?: string
  to?: string
  cc?: string
  bcc?: string
  subject?: string
  htmlBody?: string
  textBody?: string
  inReplyTo?: string
  references?: string
  draftUid?: number
}

export type ConnectionState = 'connected' | 'connecting' | 'reconnecting' | 'error'

export interface AccountConnectionStateEvent {
  accountId: string
  state: ConnectionState
  error?: string
}

export interface SyncProgressEvent {
  accountId: string
  folderId: string
  phase: 'listing' | 'fetching' | 'done'
  current: number
  total: number
}

export interface MailNewEvent {
  accountId: string
  folderId: string
  count: number
}

export interface MailFlagsChangedEvent {
  accountId: string
  folderId: string
  uid: number
  flags: string[]
}

export type ProtocolSource = 'client' | 'server' | 'info' | 'error'

/** One line of IMAP/SMTP traffic as the diagnostics view shows it. */
export interface ProtocolEntry {
  /** Monotonic across the whole log, so entries stay orderable after filtering. */
  seq: number
  at: number
  /** Milliseconds since the previous entry on the same connection. Where the waiting shows. */
  deltaMs: number
  /** Account and role, e.g. "post@example.com. Sync". */
  connection: string
  source: ProtocolSource
  text: string
}

export interface ProtocolLogState {
  recording: boolean
  /** Individual FETCH responses; they are the bulk and drown out the command flow. */
  verbose: boolean
  entries: ProtocolEntry[]
}
