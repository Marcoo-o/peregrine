import type { IpcEventMap, IpcChannels, IpcInvokeMap } from './ipcContracts'

type Invoke<K extends keyof IpcInvokeMap> = (
  args: IpcInvokeMap[K]['args']
) => Promise<IpcInvokeMap[K]['result']>

type On<K extends keyof IpcEventMap> = (listener: (payload: IpcEventMap[K]) => void) => () => void

export interface PeregrineApi {
  /** Resolves a dropped File to the path the main process can read. */
  filePath: (file: File) => string
  profiles: {
    list: () => ReturnType<Invoke<typeof IpcChannels.profilesList>>
    unlock: Invoke<typeof IpcChannels.profilesUnlock>
    create: Invoke<typeof IpcChannels.profilesCreate>
    delete: (profileId: string) => ReturnType<Invoke<typeof IpcChannels.profilesDelete>>
    current: () => ReturnType<Invoke<typeof IpcChannels.profileCurrent>>
    rename: Invoke<typeof IpcChannels.profileRename>
    setPassword: Invoke<typeof IpcChannels.profileSetPassword>
    /** Locks the profile and shows the chooser again. */
    lock: () => ReturnType<Invoke<typeof IpcChannels.profileLock>>
    listAll: () => ReturnType<Invoke<typeof IpcChannels.profileList>>
    createNew: Invoke<typeof IpcChannels.profileCreate>
  }
  accounts: {
    list: Invoke<typeof IpcChannels.accountsList>
    discover: Invoke<typeof IpcChannels.accountsDiscover>
    testConnection: Invoke<typeof IpcChannels.accountsTestConnection>
    create: Invoke<typeof IpcChannels.accountsCreate>
    remove: (accountId: string) => ReturnType<Invoke<typeof IpcChannels.accountsRemove>>
    update: Invoke<typeof IpcChannels.accountsUpdate>
    /** Accounts configured in Thunderbird, ready to be taken over. */
    scanThunderbird: () => ReturnType<Invoke<typeof IpcChannels.importThunderbirdScan>>
  }
  identities: {
    list: (accountId?: string) => ReturnType<Invoke<typeof IpcChannels.identitiesList>>
    create: Invoke<typeof IpcChannels.identitiesCreate>
    update: Invoke<typeof IpcChannels.identitiesUpdate>
    delete: (identityId: string) => ReturnType<Invoke<typeof IpcChannels.identitiesDelete>>
    setDefault: (identityId: string) => ReturnType<Invoke<typeof IpcChannels.identitiesSetDefault>>
  }
  /** Version and underpinnings, everything a fault report needs. */
  appVersion: Invoke<typeof IpcChannels.appVersion>
  settings: {
    get: Invoke<typeof IpcChannels.settingsGet>
    update: Invoke<typeof IpcChannels.settingsUpdate>
  }
  folders: {
    list: (accountId: string) => ReturnType<Invoke<typeof IpcChannels.foldersList>>
    listAll: () => ReturnType<Invoke<typeof IpcChannels.foldersListAll>>
    create: Invoke<typeof IpcChannels.foldersCreate>
    rename: Invoke<typeof IpcChannels.foldersRename>
    delete: Invoke<typeof IpcChannels.foldersDelete>
    markAllRead: Invoke<typeof IpcChannels.foldersMarkAllRead>
    emptyTrash: Invoke<typeof IpcChannels.foldersEmptyTrash>
  }
  sync: {
    all: () => ReturnType<Invoke<typeof IpcChannels.syncAll>>
  }
  messages: {
    list: Invoke<typeof IpcChannels.messagesList>
    get: Invoke<typeof IpcChannels.messagesGet>
    markRead: Invoke<typeof IpcChannels.messagesMarkRead>
    setFlagged: Invoke<typeof IpcChannels.messagesSetFlagged>
    snooze: Invoke<typeof IpcChannels.messagesSnooze>
    pendingGet: Invoke<typeof IpcChannels.pendingGet>
    pendingDiscardFailed: Invoke<typeof IpcChannels.pendingDiscardFailed>
    pendingScheduled: () => ReturnType<Invoke<typeof IpcChannels.pendingScheduled>>
    pendingCancel: (id: number) => ReturnType<Invoke<typeof IpcChannels.pendingCancel>>
    pendingWaiting: () => ReturnType<Invoke<typeof IpcChannels.pendingWaiting>>
    move: Invoke<typeof IpcChannels.messagesMove>
    archive: Invoke<typeof IpcChannels.messagesArchive>
    junk: Invoke<typeof IpcChannels.messagesJunk>
    delete: Invoke<typeof IpcChannels.messagesDelete>
    getSource: Invoke<typeof IpcChannels.messagesGetSource>
    exportEml: Invoke<typeof IpcChannels.messagesExportEml>
  }
  compose: {
    send: Invoke<typeof IpcChannels.composeSend>
    cancelSend: Invoke<typeof IpcChannels.composeCancelSend>
    saveDraft: Invoke<typeof IpcChannels.composeSaveDraft>
    deleteDraft: Invoke<typeof IpcChannels.composeDeleteDraft>
    openWindow: Invoke<typeof IpcChannels.composeOpenWindow>
    getSeed: Invoke<typeof IpcChannels.composeGetSeed>
    closeWindow: Invoke<typeof IpcChannels.composeCloseWindow>
  }
  attachments: {
    pickFiles: Invoke<typeof IpcChannels.attachmentsPickFiles>
    saveAs: Invoke<typeof IpcChannels.attachmentsSaveAs>
    open: Invoke<typeof IpcChannels.attachmentsOpen>
    cacheInfo: Invoke<typeof IpcChannels.attachmentsCacheInfo>
    clearCache: Invoke<typeof IpcChannels.attachmentsClearCache>
  }
  mailContent: {
    publish: Invoke<typeof IpcChannels.mailContentPublish>
  }
  print: {
    message: (url: string) => ReturnType<Invoke<typeof IpcChannels.printMessage>>
    toPdf: Invoke<typeof IpcChannels.printToPdf>
  }
  links: {
    openExternal: (url: string) => ReturnType<Invoke<typeof IpcChannels.linksOpenExternal>>
  }
  search: {
    messages: Invoke<typeof IpcChannels.searchMessages>
  }
  filterRules: {
    list: (accountId: string) => ReturnType<Invoke<typeof IpcChannels.filterRulesList>>
    create: Invoke<typeof IpcChannels.filterRulesCreate>
    update: Invoke<typeof IpcChannels.filterRulesUpdate>
    delete: (ruleId: string) => ReturnType<Invoke<typeof IpcChannels.filterRulesDelete>>
    setEnabled: Invoke<typeof IpcChannels.filterRulesSetEnabled>
    reorder: Invoke<typeof IpcChannels.filterRulesReorder>
    applyToFolder: Invoke<typeof IpcChannels.filterRulesApplyToFolder>
    importThunderbird: (
      accountId: string
    ) => ReturnType<Invoke<typeof IpcChannels.filterRulesImportThunderbird>>
  }
  tags: {
    list: () => ReturnType<Invoke<typeof IpcChannels.tagsList>>
    create: Invoke<typeof IpcChannels.tagsCreate>
    update: Invoke<typeof IpcChannels.tagsUpdate>
    delete: (tagId: string) => ReturnType<Invoke<typeof IpcChannels.tagsDelete>>
    setOnMessages: Invoke<typeof IpcChannels.messagesSetTag>
  }
  tasks: {
    today: () => ReturnType<Invoke<typeof IpcChannels.tasksToday>>
    create: Invoke<typeof IpcChannels.tasksCreate>
    update: Invoke<typeof IpcChannels.tasksUpdate>
    delete: (taskId: string) => ReturnType<Invoke<typeof IpcChannels.tasksDelete>>
    setDone: Invoke<typeof IpcChannels.tasksSetDone>
    addItem: Invoke<typeof IpcChannels.tasksAddItem>
    setItemDone: Invoke<typeof IpcChannels.tasksSetItemDone>
    deleteItem: (itemId: string) => ReturnType<Invoke<typeof IpcChannels.tasksDeleteItem>>
    resolveMessage: (taskId: string) => ReturnType<Invoke<typeof IpcChannels.tasksResolveMessage>>
    reorder: Invoke<typeof IpcChannels.tasksReorder>
    defer: Invoke<typeof IpcChannels.tasksDefer>
  }
  contacts: {
    list: (query?: string) => ReturnType<Invoke<typeof IpcChannels.contactsList>>
    create: (name: string, email: string) => ReturnType<Invoke<typeof IpcChannels.contactsCreate>>
    delete: (contactId: string) => ReturnType<Invoke<typeof IpcChannels.contactsDelete>>
    importVCard: () => ReturnType<Invoke<typeof IpcChannels.contactsImportVCard>>
    exportVCard: () => ReturnType<Invoke<typeof IpcChannels.contactsExportVCard>>
    importThunderbird: () => ReturnType<Invoke<typeof IpcChannels.contactsImportThunderbird>>
  }
  pgp: {
    getKeyInfo: (accountId: string) => ReturnType<Invoke<typeof IpcChannels.pgpGetKeyInfo>>
    generateKeyPair: Invoke<typeof IpcChannels.pgpGenerateKeyPair>
    setContactPublicKey: Invoke<typeof IpcChannels.pgpSetContactPublicKey>
    getContactPublicKey: (contactId: string) => ReturnType<Invoke<typeof IpcChannels.pgpGetContactPublicKey>>
    deleteAccountKey: Invoke<typeof IpcChannels.pgpDeleteAccountKey>
    importKeyPair: Invoke<typeof IpcChannels.pgpImportKeyPair>
    exportPublicKey: (accountId: string) => ReturnType<Invoke<typeof IpcChannels.pgpExportPublicKey>>
    publishKey: (accountId: string) => ReturnType<Invoke<typeof IpcChannels.pgpPublishKey>>
    deleteContactKey: (contactId: string) => ReturnType<Invoke<typeof IpcChannels.pgpDeleteContactKey>>
    contactKeyFingerprints: Invoke<typeof IpcChannels.pgpContactKeyFingerprints>
    contactKeyForAddress: Invoke<typeof IpcChannels.pgpContactKeyForAddress>
    discoverForAddress: Invoke<typeof IpcChannels.pgpDiscoverForAddress>
    listContactKeys: Invoke<typeof IpcChannels.pgpListContactKeys>
    scanKeySource: Invoke<typeof IpcChannels.pgpScanKeySource>
    chooseKeyFile: Invoke<typeof IpcChannels.pgpChooseKeyFile>
    importKeys: Invoke<typeof IpcChannels.pgpImportKeys>
    listAccountKeys: Invoke<typeof IpcChannels.pgpListAccountKeys>
    setActiveKey: Invoke<typeof IpcChannels.pgpSetActiveKey>
    contactKeyRing: Invoke<typeof IpcChannels.pgpContactKeyRing>
  }
  diagnostics: {
    get: Invoke<typeof IpcChannels.diagnosticsGet>
    setRecording: (recording: boolean) => ReturnType<Invoke<typeof IpcChannels.diagnosticsSetRecording>>
    setVerbose: (verbose: boolean) => ReturnType<Invoke<typeof IpcChannels.diagnosticsSetVerbose>>
    clear: Invoke<typeof IpcChannels.diagnosticsClear>
    export: Invoke<typeof IpcChannels.diagnosticsExport>
  }
  events: {
    onSyncProgress: On<typeof IpcChannels.syncProgress>
    onMailNew: On<typeof IpcChannels.mailNew>
    onSnoozeDue: On<typeof IpcChannels.snoozeDue>
    onPendingActions: On<typeof IpcChannels.pendingActions>
    onMailFlagsChanged: On<typeof IpcChannels.mailFlagsChanged>
    onAccountConnectionState: On<typeof IpcChannels.accountConnectionState>
    onNotificationActivated: On<typeof IpcChannels.notificationActivated>
    onLinkActivated: On<typeof IpcChannels.linkActivated>
    onSendScheduled: On<typeof IpcChannels.sendScheduled>
    onSendFailed: On<typeof IpcChannels.sendFailed>
  }
}
