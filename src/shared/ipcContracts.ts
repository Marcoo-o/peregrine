import type { KeyAssignment } from '@peregrine/core/keyImport'
import type { MailContentPolicy } from '@peregrine/core/mailCsp'
import type {
  AccountConnectionStateEvent,
  AccountKeyInfo,
  AccountCreateInput,
  AccountSummary,
  AccountUpdateInput,
  AppSettings,
  AppVersionInfo,
  AttachmentMeta,
  ComposeInput,
  ComposeSeed,
  ConnectionTestInput,
  ConnectionTestResult,
  Contact,
  ContactKeyInfo,
  DailyList,
  DiscoveryResult,
  FilterRule,
  FilterRuleInput,
  FolderNode,
  Identity,
  IdentityInput,
  KeyImportResult,
  KeyImportSource,
  MailFlagsChangedEvent,
  MailNewEvent,
  MessageActionResult,
  MessageDetail,
  MessageListFilter,
  MessageListPage,
  MessageListTarget,
  MessageRef,
  MessageSort,
  MessageSourceResult,
  PgpKeyInfo,
  ProtocolLogState,
  SearchResultItem,
  SnoozeMode,
  SyncProgressEvent,
  Tag,
  TaskInput,
  ProfileSummary,
  ProfileUnlockResult,
  ThunderbirdScanResult
} from '@peregrine/core/types'
import type { PendingSummary, ScheduledSend, WaitingAction } from '@peregrine/core/pendingActions'

export const IpcChannels = {
  profilesList: 'profiles:list',
  profilesUnlock: 'profiles:unlock',
  profilesCreate: 'profiles:create',
  profilesDelete: 'profiles:delete',
  profileCurrent: 'profile:current',
  profileRename: 'profile:rename',
  profileSetPassword: 'profile:setPassword',
  profileLock: 'profile:lock',
  profileList: 'profile:list',
  profileCreate: 'profile:create',
  accountsList: 'accounts:list',
  accountsDiscover: 'accounts:discover',
  accountsTestConnection: 'accounts:testConnection',
  accountsCreate: 'accounts:create',
  accountsRemove: 'accounts:remove',
  accountsUpdate: 'accounts:update',
  importThunderbirdScan: 'import:thunderbirdScan',
  identitiesList: 'identities:list',
  identitiesCreate: 'identities:create',
  identitiesUpdate: 'identities:update',
  identitiesDelete: 'identities:delete',
  identitiesSetDefault: 'identities:setDefault',
  appVersion: 'app:version',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  foldersList: 'folders:list',
  foldersListAll: 'folders:listAll',
  foldersCreate: 'folders:create',
  foldersRename: 'folders:rename',
  foldersDelete: 'folders:delete',
  foldersMarkAllRead: 'folders:markAllRead',
  foldersEmptyTrash: 'folders:emptyTrash',
  syncAll: 'sync:all',
  messagesList: 'messages:list',
  messagesGet: 'messages:get',
  messagesMarkRead: 'messages:markRead',
  messagesSetFlagged: 'messages:setFlagged',
  messagesMove: 'messages:move',
  messagesArchive: 'messages:archive',
  messagesJunk: 'messages:junk',
  messagesDelete: 'messages:delete',
  messagesSnooze: 'messages:snooze',
  pendingGet: 'pending:get',
  pendingDiscardFailed: 'pending:discardFailed',
  pendingScheduled: 'pending:scheduled',
  pendingCancel: 'pending:cancel',
  pendingWaiting: 'pending:waiting',
  messagesGetSource: 'messages:getSource',
  messagesExportEml: 'messages:exportEml',
  composeSend: 'compose:send',
  composeCancelSend: 'compose:cancelSend',
  composeSaveDraft: 'compose:saveDraft',
  composeDeleteDraft: 'compose:deleteDraft',
  composeOpenWindow: 'compose:openWindow',
  composeGetSeed: 'compose:getSeed',
  composeCloseWindow: 'compose:closeWindow',
  attachmentsSaveAs: 'attachments:saveAs',
  attachmentsOpen: 'attachments:open',
  attachmentsPickFiles: 'attachments:pickFiles',
  attachmentsCacheInfo: 'attachments:cacheInfo',
  attachmentsClearCache: 'attachments:clearCache',
  mailContentPublish: 'mailContent:publish',
  printMessage: 'print:message',
  printToPdf: 'print:toPdf',
  linksOpenExternal: 'links:openExternal',
  searchMessages: 'search:messages',
  filterRulesList: 'filterRules:list',
  filterRulesCreate: 'filterRules:create',
  filterRulesUpdate: 'filterRules:update',
  filterRulesDelete: 'filterRules:delete',
  filterRulesSetEnabled: 'filterRules:setEnabled',
  filterRulesReorder: 'filterRules:reorder',
  filterRulesApplyToFolder: 'filterRules:applyToFolder',
  tagsList: 'tags:list',
  tagsCreate: 'tags:create',
  tagsUpdate: 'tags:update',
  tagsDelete: 'tags:delete',
  messagesSetTag: 'messages:setTag',
  tasksToday: 'tasks:today',
  tasksCreate: 'tasks:create',
  tasksUpdate: 'tasks:update',
  tasksDelete: 'tasks:delete',
  tasksSetDone: 'tasks:setDone',
  tasksAddItem: 'tasks:addItem',
  tasksSetItemDone: 'tasks:setItemDone',
  tasksDeleteItem: 'tasks:deleteItem',
  tasksResolveMessage: 'tasks:resolveMessage',
  tasksReorder: 'tasks:reorder',
  tasksDefer: 'tasks:defer',
  contactsList: 'contacts:list',
  contactsCreate: 'contacts:create',
  contactsDelete: 'contacts:delete',
  contactsImportVCard: 'contacts:importVCard',
  contactsExportVCard: 'contacts:exportVCard',
  contactsImportThunderbird: 'contacts:importThunderbird',
  filterRulesImportThunderbird: 'filterRules:importThunderbird',
  pgpGetKeyInfo: 'pgp:getKeyInfo',
  pgpGenerateKeyPair: 'pgp:generateKeyPair',
  pgpSetContactPublicKey: 'pgp:setContactPublicKey',
  pgpGetContactPublicKey: 'pgp:getContactPublicKey',
  pgpDeleteAccountKey: 'pgp:deleteAccountKey',
  pgpImportKeyPair: 'pgp:importKeyPair',
  pgpExportPublicKey: 'pgp:exportPublicKey',
  pgpPublishKey: 'pgp:publishKey',
  pgpDeleteContactKey: 'pgp:deleteContactKey',
  pgpContactKeyFingerprints: 'pgp:contactKeyFingerprints',
  pgpContactKeyForAddress: 'pgp:contactKeyForAddress',
  pgpDiscoverForAddress: 'pgp:discoverForAddress',
  pgpListContactKeys: 'pgp:listContactKeys',
  pgpScanKeySource: 'pgp:scanKeySource',
  pgpChooseKeyFile: 'pgp:chooseKeyFile',
  pgpImportKeys: 'pgp:importKeys',
  pgpListAccountKeys: 'pgp:listAccountKeys',
  pgpSetActiveKey: 'pgp:setActiveKey',
  pgpContactKeyRing: 'pgp:contactKeyRing',
  diagnosticsGet: 'diagnostics:get',
  diagnosticsSetRecording: 'diagnostics:setRecording',
  diagnosticsSetVerbose: 'diagnostics:setVerbose',
  diagnosticsClear: 'diagnostics:clear',
  diagnosticsExport: 'diagnostics:export',
  sendScheduled: 'send:scheduled',
  sendFailed: 'send:failed',
  linkActivated: 'link:activated',
  syncProgress: 'sync:progress',
  mailNew: 'mail:new',
  snoozeDue: 'snooze:due',
  pendingActions: 'pending:actions',
  notificationActivated: 'notification:activated',
  mailFlagsChanged: 'mail:flagsChanged',
  accountConnectionState: 'account:connectionState'
} as const

export interface IpcInvokeMap {
  [IpcChannels.profilesList]: { args: void; result: ProfileSummary[] }
  /** Derives the key and opens the database; everything else waits for this to succeed. */
  [IpcChannels.profilesUnlock]: {
    args: { profileId: string; password: string }
    result: ProfileUnlockResult
  }
  [IpcChannels.profilesCreate]: { args: { name: string; password: string }; result: ProfileSummary }
  [IpcChannels.profilesDelete]: { args: { profileId: string }; result: void }
  [IpcChannels.profileCurrent]: { args: void; result: ProfileSummary | null }
  [IpcChannels.profileRename]: { args: { name: string }; result: void }
  /** Re-encrypts the open database with a key derived from the new password. */
  [IpcChannels.profileSetPassword]: {
    args: { currentPassword: string; newPassword: string }
    result: { ok: boolean; reason?: 'wrongPassword' }
  }
  /** Every profile on this machine. Shown so a new one cannot be given a name twice. */
  [IpcChannels.profileList]: { args: void; result: ProfileSummary[] }
  /** Creates a further profile beside the open one; switching to it is a separate step. */
  [IpcChannels.profileCreate]: {
    args: { name: string; password: string }
    result: ProfileSummary | { error: 'nameTaken' }
  }
  /** Closes everything and restarts into the profile chooser. Never returns. */
  [IpcChannels.profileLock]: { args: void; result: void }
  [IpcChannels.accountsList]: { args: void; result: AccountSummary[] }
  /** Server settings for an address, from the provider or from a public database. */
  [IpcChannels.accountsDiscover]: { args: { email: string }; result: DiscoveryResult }
  [IpcChannels.accountsTestConnection]: { args: ConnectionTestInput; result: ConnectionTestResult }
  [IpcChannels.accountsCreate]: { args: AccountCreateInput; result: { accountId: string } }
  [IpcChannels.accountsRemove]: { args: { accountId: string }; result: void }
  [IpcChannels.accountsUpdate]: { args: AccountUpdateInput; result: void }
  /** Reads the accounts configured in Thunderbird. Never touches its password store. */
  [IpcChannels.importThunderbirdScan]: { args: void; result: ThunderbirdScanResult }
  /** Without accountId, every identity of every account. */
  [IpcChannels.identitiesList]: { args: { accountId?: string }; result: Identity[] }
  [IpcChannels.identitiesCreate]: { args: IdentityInput; result: { identityId: string } }
  [IpcChannels.identitiesUpdate]: {
    args: { identityId: string } & Partial<IdentityInput>
    result: void
  }
  /** Refuses to remove the last identity of an account, which could then not send at all. */
  [IpcChannels.identitiesDelete]: { args: { identityId: string }; result: { removed: boolean } }
  [IpcChannels.identitiesSetDefault]: { args: { identityId: string }; result: void }
  [IpcChannels.appVersion]: { args: void; result: AppVersionInfo }
  [IpcChannels.settingsGet]: { args: void; result: AppSettings }
  [IpcChannels.settingsUpdate]: { args: Partial<AppSettings>; result: AppSettings }
  [IpcChannels.foldersList]: { args: { accountId: string }; result: FolderNode[] }
  [IpcChannels.foldersListAll]: { args: void; result: FolderNode[] }
  [IpcChannels.foldersCreate]: {
    args: { accountId: string; parentFolderId: string | null; name: string }
    result: { folderId: string }
  }
  [IpcChannels.foldersRename]: { args: { folderId: string; name: string }; result: void }
  [IpcChannels.foldersDelete]: { args: { folderId: string }; result: void }
  [IpcChannels.foldersMarkAllRead]: { args: { folderId: string }; result: { count: number } }
  [IpcChannels.foldersEmptyTrash]: { args: { accountId: string }; result: { count: number } }
  /** Refreshes every folder of every account; progress arrives via the syncProgress event. */
  [IpcChannels.syncAll]: { args: void; result: { syncedFolders: number } }
  [IpcChannels.messagesList]: {
    args: {
      targets: MessageListTarget[]
      cursor?: string
      pageSize: number
      filter?: MessageListFilter
      sort?: MessageSort
      /** Set to false to read the local cache only. Used when just re-sorting or filtering. */
      sync?: boolean
      /** Search syntax, applied on top of the targets. This is what a saved search is. */
      query?: string
      /** Messages put aside are hidden by default; 'only' lists exactly those. */
      snooze?: SnoozeMode
    }
    result: MessageListPage
  }
  [IpcChannels.messagesGet]: {
    args: { accountId: string; folderId: string; uid: number }
    result: MessageDetail
  }
  [IpcChannels.messagesMarkRead]: { args: { refs: MessageRef[]; read: boolean }; result: void }
  /** `until` as epoch ms, or null to bring the messages back straight away. */
  [IpcChannels.messagesSnooze]: { args: { refs: MessageRef[]; until: number | null }; result: void }
  /** Read once on start; afterwards the event carries every change. */
  [IpcChannels.pendingGet]: { args: void; result: PendingSummary }
  /** Messages waiting for a chosen moment, so they can still be called back. */
  [IpcChannels.pendingScheduled]: { args: void; result: ScheduledSend[] }
  /** Removes a queued entry outright; used to call back a scheduled message or a queued action. */
  [IpcChannels.pendingCancel]: { args: { id: number }; result: PendingSummary }
  /** Actions waiting for a connection, named one by one so they can be called back. */
  [IpcChannels.pendingWaiting]: { args: void; result: WaitingAction[] }
  /** Clears the actions that were given up on. The only way out once they are reported. */
  [IpcChannels.pendingDiscardFailed]: { args: void; result: PendingSummary }
  [IpcChannels.messagesSetFlagged]: { args: { refs: MessageRef[]; flagged: boolean }; result: void }
  /** Refs from other accounts than the target folder's are skipped. IMAP cannot move across servers. */
  [IpcChannels.messagesMove]: {
    args: { refs: MessageRef[]; targetFolderId: string }
    result: MessageActionResult
  }
  /** Moves into each ref's own account archive folder; refs without one are left untouched. */
  [IpcChannels.messagesArchive]: { args: { refs: MessageRef[] }; result: MessageActionResult }
  [IpcChannels.messagesJunk]: { args: { refs: MessageRef[] }; result: MessageActionResult }
  /** Without `permanent`, messages go to their account's trash folder when one exists. */
  [IpcChannels.messagesDelete]: {
    args: { refs: MessageRef[]; permanent?: boolean }
    result: MessageActionResult
  }
  /** The message exactly as the server holds it, plus its headers parsed out. */
  [IpcChannels.messagesGetSource]: { args: MessageRef; result: MessageSourceResult }
  [IpcChannels.messagesExportEml]: {
    args: { ref: MessageRef; suggestedName: string }
    result: { savedPath: string | null }
  }
  /** With a grace period configured this returns a pendingId instead of a messageId. */
  [IpcChannels.composeSend]: {
    args: ComposeInput
    result: { messageId: string; pendingId?: string }
  }
  [IpcChannels.composeCancelSend]: {
    args: { pendingId: string }
    result: { cancelled: boolean }
  }
  /** Appends the draft to the account's drafts folder and removes the previous revision. */
  [IpcChannels.composeSaveDraft]: {
    args: ComposeInput
    result: { draftUid: number | null; savedAt: string }
  }
  [IpcChannels.composeDeleteDraft]: { args: { accountId: string; uid: number }; result: void }
  [IpcChannels.composeOpenWindow]: { args: ComposeSeed; result: void }
  /** Read by a compose window on startup to learn what it should contain. */
  [IpcChannels.composeGetSeed]: { args: { seedId: string }; result: ComposeSeed | null }
  [IpcChannels.composeCloseWindow]: { args: void; result: void }
  /**
   * Asks the user where to put the attachment and copies it there.
   *
   * Addressed by the row's own id. It used to be the MIME part id, which the window rebuilt
   * from the message as `contentId ?? filename ?? 'part'`, and two attachments of one name
   * both answered to it.
   */
  [IpcChannels.attachmentsSaveAs]: {
    args: { messageId: string; attachmentId: string; suggestedName: string }
    result: { savedPath: string | null }
  }
  /**
   * Hands the cached attachment to the OS default application.
   *
   * `refused` says the main process looked at the bytes and would not open it. `executable`
   * means the content runs, `mismatch` means the content is not what the name claims.
   */
  [IpcChannels.attachmentsOpen]: {
    args: { messageId: string; attachmentId: string }
    result: { opened: boolean; refused?: 'executable' | 'mismatch' }
  }
  [IpcChannels.attachmentsPickFiles]: { args: void; result: { filePaths: string[] } }
  [IpcChannels.attachmentsCacheInfo]: { args: void; result: { sizeBytes: number } }
  [IpcChannels.attachmentsClearCache]: { args: void; result: void }
  /**
   * Publishes a message document. The window describes what it is showing, and the main
   * process turns that into the policy the document is served under.
   */
  [IpcChannels.mailContentPublish]: {
    args: { html: string; policy: MailContentPolicy }
    result: { url: string }
  }
  /** Hands a link to the system browser. Only ever called after the renderer has vetted it. */
  /** Opens the system print dialogue for a prepared peregrine-mail:// page. */
  [IpcChannels.printMessage]: { args: { url: string }; result: { printed: boolean } }
  /** Asks where to save, then renders the same page to a PDF file. */
  [IpcChannels.printToPdf]: {
    args: { url: string; suggestedName: string }
    result: { savedPath: string | null }
  }
  [IpcChannels.linksOpenExternal]: { args: { url: string }; result: void }
  /** Without `accountIds` the search spans every configured account. */
  [IpcChannels.searchMessages]: {
    args: { accountIds?: string[]; query: string; limit: number }
    result: SearchResultItem[]
  }
  [IpcChannels.filterRulesList]: { args: { accountId: string }; result: FilterRule[] }
  [IpcChannels.filterRulesCreate]: { args: FilterRuleInput; result: { ruleId: string } }
  [IpcChannels.filterRulesUpdate]: {
    args: FilterRuleInput & { ruleId: string }
    result: void
  }
  [IpcChannels.filterRulesDelete]: { args: { ruleId: string }; result: void }
  [IpcChannels.filterRulesSetEnabled]: { args: { ruleId: string; enabled: boolean }; result: void }
  /** Persists the order the rules run in; the array lists rule ids highest priority first. */
  [IpcChannels.filterRulesReorder]: { args: { accountId: string; ruleIds: string[] }; result: void }
  /** Runs the account's rules over an existing folder; omit ruleId to run all enabled rules. */
  [IpcChannels.filterRulesApplyToFolder]: {
    args: { accountId: string; folderId: string; ruleId?: string }
    result: { matched: number }
  }
  [IpcChannels.tagsList]: { args: void; result: Tag[] }
  [IpcChannels.tagsCreate]: { args: { name: string; color: string }; result: { tagId: string } }
  [IpcChannels.tagsUpdate]: { args: { tagId: string; name: string; color: string }; result: void }
  /** Forgets the definition; the keyword stays on the messages that already carry it. */
  [IpcChannels.tagsDelete]: { args: { tagId: string }; result: void }
  /** Sets or clears a tag on the server first, then locally. */
  [IpcChannels.messagesSetTag]: {
    args: { refs: MessageRef[]; tagId: string; apply: boolean }
    result: { changed: number }
  }
  /** Everything on today's list: stored tasks whose rule covers today, plus tagged mail. */
  [IpcChannels.tasksToday]: { args: void; result: DailyList }
  [IpcChannels.tasksCreate]: { args: TaskInput; result: { taskId: string } }
  [IpcChannels.tasksUpdate]: {
    args: { taskId: string; title?: string; notes?: string; recurrence?: string }
    result: void
  }
  [IpcChannels.tasksDelete]: { args: { taskId: string }; result: void }
  /** Ticking records the day, so a repeating task is open again tomorrow. */
  [IpcChannels.tasksSetDone]: { args: { taskId: string; done: boolean }; result: void }
  [IpcChannels.tasksAddItem]: { args: { taskId: string; title: string }; result: { itemId: string } }
  [IpcChannels.tasksSetItemDone]: { args: { itemId: string; done: boolean }; result: void }
  [IpcChannels.tasksDeleteItem]: { args: { itemId: string }; result: void }
  /** Where the task's message is now; null once it can no longer be found. */
  [IpcChannels.tasksResolveMessage]: { args: { taskId: string }; result: MessageRef | null }
  /** The order the user dragged the list into; positions are rewritten from scratch. */
  [IpcChannels.tasksReorder]: { args: { taskIds: string[] }; result: void }
  /** Moves a one-off task to the next day.  is false for a recurring one. */
  [IpcChannels.tasksDefer]: {
    args: { taskId: string }
    result: { moved: boolean; toDay: string }
  }
  [IpcChannels.contactsList]: { args: { query?: string }; result: Contact[] }
  [IpcChannels.contactsCreate]: { args: { name: string; email: string }; result: { contactId: string } }
  [IpcChannels.contactsDelete]: { args: { contactId: string }; result: void }
  [IpcChannels.contactsImportVCard]: {
    args: Record<string, never>
    result: { added: number; updated: number; skipped: number } | null
  }
  [IpcChannels.contactsExportVCard]: {
    args: Record<string, never>
    result: { savedPath: string; count: number } | null
  }
  /** Reads Thunderbird's address books. Null when no profile was found at all. */
  [IpcChannels.contactsImportThunderbird]: {
    args: Record<string, never>
    result: { added: number; updated: number; skipped: number } | null
  }
  /** Reads the filter rules of one account. Null when no profile was found at all. */
  [IpcChannels.filterRulesImportThunderbird]: {
    args: { accountId: string }
    result: { imported: number; skipped: { name: string; reason: string }[] } | null
  }
  [IpcChannels.pgpGetKeyInfo]: { args: { accountId: string }; result: PgpKeyInfo | null }
  [IpcChannels.pgpGenerateKeyPair]: {
    args: { accountId: string; name: string; email: string }
    result: PgpKeyInfo
  }
  [IpcChannels.pgpSetContactPublicKey]: {
    args: { contactId: string; publicKeyArmored: string }
    result: { fingerprint: string }
  }
  [IpcChannels.pgpGetContactPublicKey]: { args: { contactId: string }; result: string | null }
  /** Dropping one key from the ring; without a fingerprint the whole ring goes. */
  [IpcChannels.pgpDeleteAccountKey]: {
    args: { accountId: string; fingerprint?: string }
    result: void
  }
  [IpcChannels.pgpImportKeyPair]: {
    /** The passphrase is only needed for a sealed key; an open one ignores it. */
    args: { accountId: string; privateKeyArmored: string; passphrase?: string }
    result: PgpKeyInfo
  }
  [IpcChannels.pgpExportPublicKey]: {
    args: { accountId: string }
    result: { savedPath: string | null }
  }
  [IpcChannels.pgpPublishKey]: {
    args: { accountId: string }
    result: { fingerprint: string; status: Record<string, string> }
  }
  [IpcChannels.pgpDeleteContactKey]: { args: { contactId: string }; result: void }
  [IpcChannels.pgpContactKeyFingerprints]: { args: void; result: Record<string, string> }
  /** What is known about the key for one address, for the reading pane. */
  [IpcChannels.pgpContactKeyForAddress]: { args: { email: string }; result: ContactKeyInfo | null }
  /** Looks a key up by address alone, creating the contact if there is none yet. */
  [IpcChannels.pgpDiscoverForAddress]: {
    args: { email: string; name?: string; accountId?: string }
    result: { found: boolean; key?: ContactKeyInfo }
  }
  [IpcChannels.pgpListContactKeys]: { args: void; result: ContactKeyInfo[] }
  /** What a keyring or key file holds, already matched against the accounts set up here. */
  [IpcChannels.pgpScanKeySource]: {
    args: { source: KeyImportSource }
    result: { origin: string | null; assignments: KeyAssignment[] }
  }
  /** Every key this account holds, active first. */
  [IpcChannels.pgpListAccountKeys]: { args: { accountId: string }; result: AccountKeyInfo[] }
  /** Which key signs from now on. The rest stay for reading the past. */
  /** Every key held for a contact, active first. The retired ones still verify old mail. */
  [IpcChannels.pgpContactKeyRing]: {
    args: { contactId: string }
    result: { fingerprint: string; isActive: boolean; source: string; createdAt: string }[]
  }
  [IpcChannels.pgpSetActiveKey]: {
    args: { accountId: string; fingerprint: string }
    result: void
  }
  /** Opens the file dialog in the main process; null when the user cancels. */
  [IpcChannels.pgpChooseKeyFile]: { args: void; result: { path: string } | null }
  /** Takes the chosen keys over. Where each one lands is decided in the main process. */
  [IpcChannels.pgpImportKeys]: {
    args: { source: KeyImportSource; fingerprints: string[]; passphrase: string }
    result: KeyImportResult[]
  }
  /** What the connections said, with timings. Empty until recording is switched on. */
  [IpcChannels.diagnosticsGet]: { args: void; result: ProtocolLogState }
  /** Switching recording on also clears, so a fresh reproduction stands on its own. */
  [IpcChannels.diagnosticsSetRecording]: { args: { recording: boolean }; result: ProtocolLogState }
  [IpcChannels.diagnosticsSetVerbose]: { args: { verbose: boolean }; result: ProtocolLogState }
  [IpcChannels.diagnosticsClear]: { args: void; result: ProtocolLogState }
  [IpcChannels.diagnosticsExport]: { args: void; result: { savedPath: string | null } }
}

export interface IpcEventMap {
  /**
   * Someone clicked a link inside a message. The main process does not open it: the renderer
   * decides, because that is where the link can be checked and, if it looks like a forgery,
   * shown to the user before anything happens.
   */
  /** A message is waiting out its undo window; the mailbox shows the countdown. */
  [IpcChannels.sendScheduled]: { pendingId: string; seconds: number; subject: string }
  /** A message whose grace period elapsed could not be sent. */
  [IpcChannels.sendFailed]: { pendingId: string; message: string }
  [IpcChannels.linkActivated]: { url: string }
  [IpcChannels.syncProgress]: SyncProgressEvent
  [IpcChannels.mailNew]: MailNewEvent
  /** Messages put aside have come back; the renderer refreshes whatever is on screen. */
  [IpcChannels.snoozeDue]: { count: number }
  /** What is still waiting for a connection, and what was given up on. */
  [IpcChannels.pendingActions]: PendingSummary
  /** The user clicked a "new mail" desktop notification; the renderer opens that message. */
  [IpcChannels.notificationActivated]: MessageRef
  [IpcChannels.mailFlagsChanged]: MailFlagsChangedEvent
  [IpcChannels.accountConnectionState]: AccountConnectionStateEvent
}

export type { AttachmentMeta }
