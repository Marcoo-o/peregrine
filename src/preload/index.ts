import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IpcChannels, type IpcEventMap, type IpcInvokeMap } from '../shared/ipcContracts'
import type { PeregrineApi } from '../shared/preloadApi'

function invoke<K extends keyof IpcInvokeMap>(
  channel: K,
  args: IpcInvokeMap[K]['args']
): Promise<IpcInvokeMap[K]['result']> {
  return ipcRenderer.invoke(channel, args)
}

function on<K extends keyof IpcEventMap>(
  channel: K,
  listener: (payload: IpcEventMap[K]) => void
): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: IpcEventMap[K]): void =>
    listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: PeregrineApi = {
  /**
   * The real path behind a dropped File.
   *
   * Not IPC: it is a lookup Electron provides in the preload, and the renderer cannot reach
   * it itself. Only what the user actually dropped can be resolved this way.
   */
  filePath: (file: File) => webUtils.getPathForFile(file),
  profiles: {
    list: () => invoke(IpcChannels.profilesList, undefined),
    unlock: (args: IpcInvokeMap[typeof IpcChannels.profilesUnlock]['args']) =>
      invoke(IpcChannels.profilesUnlock, args),
    create: (args: IpcInvokeMap[typeof IpcChannels.profilesCreate]['args']) =>
      invoke(IpcChannels.profilesCreate, args),
    delete: (profileId: string) => invoke(IpcChannels.profilesDelete, { profileId }),
    current: () => invoke(IpcChannels.profileCurrent, undefined),
    rename: (args: IpcInvokeMap[typeof IpcChannels.profileRename]['args']) =>
      invoke(IpcChannels.profileRename, args),
    setPassword: (args: IpcInvokeMap[typeof IpcChannels.profileSetPassword]['args']) =>
      invoke(IpcChannels.profileSetPassword, args),
    lock: () => invoke(IpcChannels.profileLock, undefined),
    listAll: () => invoke(IpcChannels.profileList, undefined),
    createNew: (args: IpcInvokeMap[typeof IpcChannels.profileCreate]['args']) =>
      invoke(IpcChannels.profileCreate, args)
  },
  accounts: {
    list: () => invoke(IpcChannels.accountsList, undefined),
    discover: (args: IpcInvokeMap[typeof IpcChannels.accountsDiscover]['args']) =>
      invoke(IpcChannels.accountsDiscover, args),
    testConnection: (args: IpcInvokeMap[typeof IpcChannels.accountsTestConnection]['args']) =>
      invoke(IpcChannels.accountsTestConnection, args),
    create: (args: IpcInvokeMap[typeof IpcChannels.accountsCreate]['args']) =>
      invoke(IpcChannels.accountsCreate, args),
    remove: (accountId: string) => invoke(IpcChannels.accountsRemove, { accountId }),
    update: (args: IpcInvokeMap[typeof IpcChannels.accountsUpdate]['args']) =>
      invoke(IpcChannels.accountsUpdate, args),
    scanThunderbird: () => invoke(IpcChannels.importThunderbirdScan, undefined)
  },
  identities: {
    list: (accountId?: string) => invoke(IpcChannels.identitiesList, { accountId }),
    create: (args: IpcInvokeMap[typeof IpcChannels.identitiesCreate]['args']) =>
      invoke(IpcChannels.identitiesCreate, args),
    update: (args: IpcInvokeMap[typeof IpcChannels.identitiesUpdate]['args']) =>
      invoke(IpcChannels.identitiesUpdate, args),
    delete: (identityId: string) => invoke(IpcChannels.identitiesDelete, { identityId }),
    setDefault: (identityId: string) => invoke(IpcChannels.identitiesSetDefault, { identityId })
  },
  appVersion: () => invoke(IpcChannels.appVersion, undefined),
  settings: {
    get: () => invoke(IpcChannels.settingsGet, undefined),
    update: (args: IpcInvokeMap[typeof IpcChannels.settingsUpdate]['args']) =>
      invoke(IpcChannels.settingsUpdate, args)
  },
  folders: {
    list: (accountId: string) => invoke(IpcChannels.foldersList, { accountId }),
    listAll: () => invoke(IpcChannels.foldersListAll, undefined),
    create: (args: IpcInvokeMap[typeof IpcChannels.foldersCreate]['args']) =>
      invoke(IpcChannels.foldersCreate, args),
    rename: (args: IpcInvokeMap[typeof IpcChannels.foldersRename]['args']) =>
      invoke(IpcChannels.foldersRename, args),
    delete: (args: IpcInvokeMap[typeof IpcChannels.foldersDelete]['args']) =>
      invoke(IpcChannels.foldersDelete, args),
    markAllRead: (args: IpcInvokeMap[typeof IpcChannels.foldersMarkAllRead]['args']) =>
      invoke(IpcChannels.foldersMarkAllRead, args),
    emptyTrash: (args: IpcInvokeMap[typeof IpcChannels.foldersEmptyTrash]['args']) =>
      invoke(IpcChannels.foldersEmptyTrash, args)
  },
  sync: {
    all: () => invoke(IpcChannels.syncAll, undefined)
  },
  messages: {
    list: (args: IpcInvokeMap[typeof IpcChannels.messagesList]['args']) =>
      invoke(IpcChannels.messagesList, args),
    get: (args: IpcInvokeMap[typeof IpcChannels.messagesGet]['args']) =>
      invoke(IpcChannels.messagesGet, args),
    markRead: (args: IpcInvokeMap[typeof IpcChannels.messagesMarkRead]['args']) =>
      invoke(IpcChannels.messagesMarkRead, args),
    setFlagged: (args: IpcInvokeMap[typeof IpcChannels.messagesSetFlagged]['args']) =>
      invoke(IpcChannels.messagesSetFlagged, args),
    snooze: (args: IpcInvokeMap[typeof IpcChannels.messagesSnooze]['args']) =>
      invoke(IpcChannels.messagesSnooze, args),
    pendingGet: () => invoke(IpcChannels.pendingGet, undefined),
    pendingDiscardFailed: () => invoke(IpcChannels.pendingDiscardFailed, undefined),
    pendingScheduled: () => invoke(IpcChannels.pendingScheduled, undefined),
    pendingCancel: (id: number) => invoke(IpcChannels.pendingCancel, { id }),
    pendingWaiting: () => invoke(IpcChannels.pendingWaiting, undefined),
    move: (args: IpcInvokeMap[typeof IpcChannels.messagesMove]['args']) =>
      invoke(IpcChannels.messagesMove, args),
    archive: (args: IpcInvokeMap[typeof IpcChannels.messagesArchive]['args']) =>
      invoke(IpcChannels.messagesArchive, args),
    junk: (args: IpcInvokeMap[typeof IpcChannels.messagesJunk]['args']) =>
      invoke(IpcChannels.messagesJunk, args),
    delete: (args: IpcInvokeMap[typeof IpcChannels.messagesDelete]['args']) =>
      invoke(IpcChannels.messagesDelete, args),
    getSource: (args: IpcInvokeMap[typeof IpcChannels.messagesGetSource]['args']) =>
      invoke(IpcChannels.messagesGetSource, args),
    exportEml: (args: IpcInvokeMap[typeof IpcChannels.messagesExportEml]['args']) =>
      invoke(IpcChannels.messagesExportEml, args)
  },
  compose: {
    send: (args: IpcInvokeMap[typeof IpcChannels.composeSend]['args']) =>
      invoke(IpcChannels.composeSend, args),
    cancelSend: (args: IpcInvokeMap[typeof IpcChannels.composeCancelSend]['args']) =>
      invoke(IpcChannels.composeCancelSend, args),
    saveDraft: (args: IpcInvokeMap[typeof IpcChannels.composeSaveDraft]['args']) =>
      invoke(IpcChannels.composeSaveDraft, args),
    deleteDraft: (args: IpcInvokeMap[typeof IpcChannels.composeDeleteDraft]['args']) =>
      invoke(IpcChannels.composeDeleteDraft, args),
    openWindow: (args: IpcInvokeMap[typeof IpcChannels.composeOpenWindow]['args']) =>
      invoke(IpcChannels.composeOpenWindow, args),
    getSeed: (args: IpcInvokeMap[typeof IpcChannels.composeGetSeed]['args']) =>
      invoke(IpcChannels.composeGetSeed, args),
    closeWindow: () => invoke(IpcChannels.composeCloseWindow, undefined)
  },
  attachments: {
    pickFiles: () => invoke(IpcChannels.attachmentsPickFiles, undefined),
    saveAs: (args: IpcInvokeMap[typeof IpcChannels.attachmentsSaveAs]['args']) =>
      invoke(IpcChannels.attachmentsSaveAs, args),
    open: (args: IpcInvokeMap[typeof IpcChannels.attachmentsOpen]['args']) =>
      invoke(IpcChannels.attachmentsOpen, args),
    cacheInfo: () => invoke(IpcChannels.attachmentsCacheInfo, undefined),
    clearCache: () => invoke(IpcChannels.attachmentsClearCache, undefined)
  },
  mailContent: {
    publish: (args: IpcInvokeMap[typeof IpcChannels.mailContentPublish]['args']) =>
      invoke(IpcChannels.mailContentPublish, args)
  },
  print: {
    message: (url: string) => invoke(IpcChannels.printMessage, { url }),
    toPdf: (args: IpcInvokeMap[typeof IpcChannels.printToPdf]['args']) =>
      invoke(IpcChannels.printToPdf, args)
  },
  links: {
    openExternal: (url: string) => invoke(IpcChannels.linksOpenExternal, { url })
  },
  search: {
    messages: (args: IpcInvokeMap[typeof IpcChannels.searchMessages]['args']) =>
      invoke(IpcChannels.searchMessages, args)
  },
  filterRules: {
    list: (accountId: string) => invoke(IpcChannels.filterRulesList, { accountId }),
    create: (args: IpcInvokeMap[typeof IpcChannels.filterRulesCreate]['args']) =>
      invoke(IpcChannels.filterRulesCreate, args),
    update: (args: IpcInvokeMap[typeof IpcChannels.filterRulesUpdate]['args']) =>
      invoke(IpcChannels.filterRulesUpdate, args),
    delete: (ruleId: string) => invoke(IpcChannels.filterRulesDelete, { ruleId }),
    setEnabled: (args: IpcInvokeMap[typeof IpcChannels.filterRulesSetEnabled]['args']) =>
      invoke(IpcChannels.filterRulesSetEnabled, args),
    reorder: (args: IpcInvokeMap[typeof IpcChannels.filterRulesReorder]['args']) =>
      invoke(IpcChannels.filterRulesReorder, args),
    applyToFolder: (args: IpcInvokeMap[typeof IpcChannels.filterRulesApplyToFolder]['args']) =>
      invoke(IpcChannels.filterRulesApplyToFolder, args),
    importThunderbird: (accountId: string) =>
      invoke(IpcChannels.filterRulesImportThunderbird, { accountId })
  },
  tags: {
    list: () => invoke(IpcChannels.tagsList, undefined),
    create: (args: IpcInvokeMap[typeof IpcChannels.tagsCreate]['args']) =>
      invoke(IpcChannels.tagsCreate, args),
    update: (args: IpcInvokeMap[typeof IpcChannels.tagsUpdate]['args']) =>
      invoke(IpcChannels.tagsUpdate, args),
    delete: (tagId: string) => invoke(IpcChannels.tagsDelete, { tagId }),
    setOnMessages: (args: IpcInvokeMap[typeof IpcChannels.messagesSetTag]['args']) =>
      invoke(IpcChannels.messagesSetTag, args)
  },
  tasks: {
    today: () => invoke(IpcChannels.tasksToday, undefined),
    create: (args: IpcInvokeMap[typeof IpcChannels.tasksCreate]['args']) =>
      invoke(IpcChannels.tasksCreate, args),
    update: (args: IpcInvokeMap[typeof IpcChannels.tasksUpdate]['args']) =>
      invoke(IpcChannels.tasksUpdate, args),
    delete: (taskId: string) => invoke(IpcChannels.tasksDelete, { taskId }),
    setDone: (args: IpcInvokeMap[typeof IpcChannels.tasksSetDone]['args']) =>
      invoke(IpcChannels.tasksSetDone, args),
    addItem: (args: IpcInvokeMap[typeof IpcChannels.tasksAddItem]['args']) =>
      invoke(IpcChannels.tasksAddItem, args),
    setItemDone: (args: IpcInvokeMap[typeof IpcChannels.tasksSetItemDone]['args']) =>
      invoke(IpcChannels.tasksSetItemDone, args),
    deleteItem: (itemId: string) => invoke(IpcChannels.tasksDeleteItem, { itemId }),
    resolveMessage: (taskId: string) => invoke(IpcChannels.tasksResolveMessage, { taskId }),
    reorder: (args: IpcInvokeMap[typeof IpcChannels.tasksReorder]['args']) =>
      invoke(IpcChannels.tasksReorder, args),
    defer: (args: IpcInvokeMap[typeof IpcChannels.tasksDefer]['args']) =>
      invoke(IpcChannels.tasksDefer, args)
  },
  contacts: {
    list: (query?: string) => invoke(IpcChannels.contactsList, { query }),
    create: (name: string, email: string) => invoke(IpcChannels.contactsCreate, { name, email }),
    delete: (contactId: string) => invoke(IpcChannels.contactsDelete, { contactId }),
    importVCard: () => invoke(IpcChannels.contactsImportVCard, {}),
    exportVCard: () => invoke(IpcChannels.contactsExportVCard, {}),
    importThunderbird: () => invoke(IpcChannels.contactsImportThunderbird, {})
  },
  pgp: {
    getKeyInfo: (accountId: string) => invoke(IpcChannels.pgpGetKeyInfo, { accountId }),
    generateKeyPair: (args: IpcInvokeMap[typeof IpcChannels.pgpGenerateKeyPair]['args']) =>
      invoke(IpcChannels.pgpGenerateKeyPair, args),
    setContactPublicKey: (args: IpcInvokeMap[typeof IpcChannels.pgpSetContactPublicKey]['args']) =>
      invoke(IpcChannels.pgpSetContactPublicKey, args),
    getContactPublicKey: (contactId: string) =>
      invoke(IpcChannels.pgpGetContactPublicKey, { contactId }),
    deleteAccountKey: (args: IpcInvokeMap[typeof IpcChannels.pgpDeleteAccountKey]['args']) =>
      invoke(IpcChannels.pgpDeleteAccountKey, args),
    importKeyPair: (args: IpcInvokeMap[typeof IpcChannels.pgpImportKeyPair]['args']) =>
      invoke(IpcChannels.pgpImportKeyPair, args),
    exportPublicKey: (accountId: string) => invoke(IpcChannels.pgpExportPublicKey, { accountId }),
    publishKey: (accountId: string) => invoke(IpcChannels.pgpPublishKey, { accountId }),
    deleteContactKey: (contactId: string) =>
      invoke(IpcChannels.pgpDeleteContactKey, { contactId }),
    contactKeyFingerprints: () => invoke(IpcChannels.pgpContactKeyFingerprints, undefined),
    contactKeyForAddress: (args: IpcInvokeMap[typeof IpcChannels.pgpContactKeyForAddress]['args']) =>
      invoke(IpcChannels.pgpContactKeyForAddress, args),
    discoverForAddress: (args: IpcInvokeMap[typeof IpcChannels.pgpDiscoverForAddress]['args']) =>
      invoke(IpcChannels.pgpDiscoverForAddress, args),
    listContactKeys: () => invoke(IpcChannels.pgpListContactKeys, undefined),
    scanKeySource: (args: IpcInvokeMap[typeof IpcChannels.pgpScanKeySource]['args']) =>
      invoke(IpcChannels.pgpScanKeySource, args),
    chooseKeyFile: () => invoke(IpcChannels.pgpChooseKeyFile, undefined),
    importKeys: (args: IpcInvokeMap[typeof IpcChannels.pgpImportKeys]['args']) =>
      invoke(IpcChannels.pgpImportKeys, args),
    listAccountKeys: (args: IpcInvokeMap[typeof IpcChannels.pgpListAccountKeys]['args']) =>
      invoke(IpcChannels.pgpListAccountKeys, args),
    setActiveKey: (args: IpcInvokeMap[typeof IpcChannels.pgpSetActiveKey]['args']) =>
      invoke(IpcChannels.pgpSetActiveKey, args),
    contactKeyRing: (args: IpcInvokeMap[typeof IpcChannels.pgpContactKeyRing]['args']) =>
      invoke(IpcChannels.pgpContactKeyRing, args)
  },
  diagnostics: {
    get: () => invoke(IpcChannels.diagnosticsGet, undefined),
    setRecording: (recording: boolean) =>
      invoke(IpcChannels.diagnosticsSetRecording, { recording }),
    setVerbose: (verbose: boolean) => invoke(IpcChannels.diagnosticsSetVerbose, { verbose }),
    clear: () => invoke(IpcChannels.diagnosticsClear, undefined),
    export: () => invoke(IpcChannels.diagnosticsExport, undefined)
  },
  events: {
    onSyncProgress: (listener: (payload: IpcEventMap[typeof IpcChannels.syncProgress]) => void) =>
      on(IpcChannels.syncProgress, listener),
    onMailNew: (listener: (payload: IpcEventMap[typeof IpcChannels.mailNew]) => void) =>
      on(IpcChannels.mailNew, listener),
    onSnoozeDue: (listener: (payload: IpcEventMap[typeof IpcChannels.snoozeDue]) => void) =>
      on(IpcChannels.snoozeDue, listener),
    onPendingActions: (listener: (payload: IpcEventMap[typeof IpcChannels.pendingActions]) => void) =>
      on(IpcChannels.pendingActions, listener),
    onMailFlagsChanged: (
      listener: (payload: IpcEventMap[typeof IpcChannels.mailFlagsChanged]) => void
    ) => on(IpcChannels.mailFlagsChanged, listener),
    onAccountConnectionState: (
      listener: (payload: IpcEventMap[typeof IpcChannels.accountConnectionState]) => void
    ) => on(IpcChannels.accountConnectionState, listener),
    onNotificationActivated: (
      listener: (payload: IpcEventMap[typeof IpcChannels.notificationActivated]) => void
    ) => on(IpcChannels.notificationActivated, listener),
    onLinkActivated: (listener: (payload: IpcEventMap[typeof IpcChannels.linkActivated]) => void) =>
      on(IpcChannels.linkActivated, listener),
    onSendScheduled: (listener: (payload: IpcEventMap[typeof IpcChannels.sendScheduled]) => void) =>
      on(IpcChannels.sendScheduled, listener),
    onSendFailed: (listener: (payload: IpcEventMap[typeof IpcChannels.sendFailed]) => void) =>
      on(IpcChannels.sendFailed, listener)
  }
}

contextBridge.exposeInMainWorld('peregrine', api)
