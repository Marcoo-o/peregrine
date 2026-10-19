import { errorText } from '@renderer/util/errorText'
import { create } from 'zustand'
import type {
  FolderNode,
  MessageListFilter,
  MessageListPage,
  MessageListTarget,
  MessageRef,
  MessageSort,
  MessageSortField,
  MessageSummary,
  SpecialUse
} from '@peregrine/core/types'
import { parseSavedSearches, type SavedSearch } from '@peregrine/core/savedSearches'
import { currentSettings, useSettingsStore } from './settingsStore'

/** Special-use folders that get a combined node spanning every account. */
export const UNIFIED_SPECIAL_USES = [
  'inbox',
  'drafts',
  'sent',
  'archive',
  'junk',
  'trash'
] as const
export type UnifiedSpecialUse = (typeof UNIFIED_SPECIAL_USES)[number]

export type MailboxView =
  | { kind: 'unified'; specialUse: UnifiedSpecialUse }
  | { kind: 'folder'; folderId: string }
  | { kind: 'search'; searchId: string }
  | { kind: 'snoozed' }
  /** The daily list; it holds no mail of its own, so it has no targets. */
  | { kind: 'daily' }

export function viewKey(view: MailboxView | null): string {
  if (!view) return ''
  if (view.kind === 'unified') return `unified:${view.specialUse}`
  if (view.kind === 'search') return `search:${view.searchId}`
  if (view.kind === 'snoozed') return 'snoozed'
  if (view.kind === 'daily') return 'daily'
  return `folder:${view.folderId}`
}

interface MailboxState {
  folders: FolderNode[]
  view: MailboxView | null
  messages: MessageSummary[]
  totalCount: number
  nextCursor: string | null
  loadingFolders: boolean
  loadingMessages: boolean
  foldersError: string | null
  messagesError: string | null
  filter: MessageListFilter
  sort: MessageSort
  /** Message ids, so a selection survives across accounts in unified views. */
  selectedIds: string[]
  activeId: string | null
  /** Drives the sidebar entry, which only exists while something is actually waiting. */
  snoozedCount: number

  loadFolders: () => Promise<void>
  loadSnoozedCount: () => Promise<void>
  setView: (view: MailboxView) => void
  loadMessages: (append?: boolean, options?: { sync?: boolean }) => Promise<void>
  setFilter: (patch: MessageListFilter) => void
  toggleSort: (field: MessageSortField) => void
  setSelection: (ids: string[], activeId: string | null) => void
  targets: () => MessageListTarget[]
  refsFor: (ids: string[]) => MessageRef[]
  selectedMessages: () => MessageSummary[]
}

const PAGE_SIZE = 60

/** Where a search looks when it is not restricted: everywhere the mail actually is. */
function searchTargets(folders: FolderNode[], search: SavedSearch): MessageListTarget[] {
  return folders
    .filter((folder) => search.accountIds.length === 0 || search.accountIds.includes(folder.accountId))
    .filter(
      (folder) => search.includeTrash || (folder.specialUse !== 'trash' && folder.specialUse !== 'junk')
    )
    .map((folder) => ({ accountId: folder.accountId, folderId: folder.id }))
}

function targetsForView(folders: FolderNode[], view: MailboxView | null): MessageListTarget[] {
  if (!view) return []
  if (view.kind === 'folder') {
    const folder = folders.find((f) => f.id === view.folderId)
    return folder ? [{ accountId: folder.accountId, folderId: folder.id }] : []
  }
  if (view.kind === 'search') {
    const search = savedSearchById(view.searchId)
    return search ? searchTargets(folders, search) : []
  }
  // The daily list holds tasks, not mail; it reads its own tables.
  if (view.kind === 'daily') return []
  // A message put aside stays in the folder it was in, so the reminder list has to look
  // everywhere. Including trash and junk, where one may well have put something aside
  // before deciding.
  if (view.kind === 'snoozed') {
    return folders.map((folder) => ({ accountId: folder.accountId, folderId: folder.id }))
  }
  return folders
    .filter((folder) => folder.specialUse === (view.specialUse as SpecialUse))
    .map((folder) => ({ accountId: folder.accountId, folderId: folder.id }))
}

export function savedSearchById(searchId: string): SavedSearch | undefined {
  return parseSavedSearches(currentSettings().savedSearches).find(
    (search) => search.id === searchId
  )
}

/** Picks the view to show on first load: the unified inbox, or the first inbox found. */
function defaultView(folders: FolderNode[]): MailboxView | null {
  const inboxes = folders.filter((folder) => folder.specialUse === 'inbox')
  if (inboxes.length === 0) return folders[0] ? { kind: 'folder', folderId: folders[0].id } : null
  if (currentSettings().unifiedFolders && inboxes.length > 1) {
    return { kind: 'unified', specialUse: 'inbox' }
  }
  return { kind: 'folder', folderId: inboxes[0].id }
}

export const useMailboxStore = create<MailboxState>((set, get) => ({
  folders: [],
  view: null,
  messages: [],
  totalCount: 0,
  nextCursor: null,
  loadingFolders: false,
  loadingMessages: false,
  foldersError: null,
  messagesError: null,
  filter: {},
  sort: { field: currentSettings().sortField, direction: currentSettings().sortDirection },
  selectedIds: [],
  activeId: null,
  snoozedCount: 0,

  loadFolders: async () => {
    set({ loadingFolders: true, foldersError: null })
    try {
      const folders = await window.peregrine.folders.listAll()
      const view = get().view ?? defaultView(folders)
      set({ folders, loadingFolders: false, view })
      void get().loadSnoozedCount()
    } catch (err) {
      const message = errorText(err)
      console.error('folders.listAll failed:', message)
      set({ loadingFolders: false, foldersError: message })
    }
  },

  /** One page of one, read for its total: there is no cheaper count over the IPC contract. */
  loadSnoozedCount: async () => {
    const targets = get().folders.map((folder) => ({
      accountId: folder.accountId,
      folderId: folder.id
    }))
    if (targets.length === 0) {
      set({ snoozedCount: 0 })
      return
    }
    try {
      const page = await window.peregrine.messages.list({
        targets,
        pageSize: 1,
        sync: false,
        snooze: 'only'
      })
      set({ snoozedCount: page.totalCount })
    } catch (err) {
      console.error('counting the messages put aside failed:', err)
    }
  },

  setView: (view) => {
    if (viewKey(view) === viewKey(get().view)) return
    set({ view, messages: [], nextCursor: null, totalCount: 0, selectedIds: [], activeId: null })
  },

  loadMessages: async (append = false, options) => {
    if (append && get().nextCursor === null) return
    if (get().loadingMessages) return
    const targets = get().targets()
    if (targets.length === 0) {
      set({ messages: [], nextCursor: null, totalCount: 0 })
      return
    }

    set({ loadingMessages: true, messagesError: null })

    const view = get().view
    const search = view?.kind === 'search' ? savedSearchById(view.searchId) : undefined

    /**
     * A saved search never triggers a sync.
     *
     * It spans every folder of every account, so refreshing them all would turn one click in
     * the sidebar into the full "fetch everything" round. The background sync keeps the cache
     * current; a saved search reads what is there.
     */
    const snoozedView = view?.kind === 'snoozed'
    const syncAllowed = !search && !snoozedView

    const request = (sync: boolean | undefined): Promise<MessageListPage> =>
      window.peregrine.messages.list({
        targets,
        cursor: append ? (get().nextCursor ?? undefined) : undefined,
        pageSize: PAGE_SIZE,
        filter: get().filter,
        sort: get().sort,
        sync,
        query: search?.query,
        // A search finds a message whether or not it is waiting to come back; everywhere
        // else, "put aside" has to mean out of sight, or the feature does nothing.
        snooze: snoozedView ? 'only' : search ? 'all' : 'hide'
      })

    const apply = (page: MessageListPage): void =>
      set((state) => ({
        messages: append ? [...state.messages, ...page.items] : page.items,
        nextCursor: page.nextCursor,
        totalCount: page.totalCount,
        loadingMessages: false
      }))

    try {
      /**
       * Show the cache first, then catch up with the server.
       *
       * The cached rows are a local database read and arrive in milliseconds, while the sync
       * has to reach the server for every folder in view. Waiting for the latter before
       * showing anything is what made switching folders feel slow. The messages were already
       * there, just behind a network round trip.
       */
      const wantsSync = syncAllowed && !append && options?.sync !== false
      if (wantsSync) {
        apply(await request(false))

        const requestedFor = viewKey(get().view)
        void request(true)
          .then((page) => {
            // The user may have moved on while the server was answering; a late reply must
            // not overwrite a list that now belongs to a different folder.
            if (viewKey(get().view) === requestedFor) apply(page)
          })
          .catch((err) => {
            console.error('background sync of the list failed:', err)
          })
        return
      }

      apply(await request(syncAllowed ? options?.sync : false))
    } catch (err) {
      const message = errorText(err)
      console.error('messages.list failed:', message)
      set({ loadingMessages: false, messagesError: message })
    }
  },

  setFilter: (patch) => {
    set((state) => ({ filter: { ...state.filter, ...patch }, nextCursor: null }))
    void get().loadMessages(false, { sync: false })
  },

  toggleSort: (field) => {
    const current = get().sort
    const direction =
      current.field === field ? (current.direction === 'asc' ? 'desc' : 'asc') : 'desc'
    set({ sort: { field, direction }, nextCursor: null })
    void useSettingsStore.getState().update({ sortField: field, sortDirection: direction })
    void get().loadMessages(false, { sync: false })
  },

  setSelection: (ids, activeId) => set({ selectedIds: ids, activeId }),

  targets: () => targetsForView(get().folders, get().view),

  refsFor: (ids) => {
    const wanted = new Set(ids)
    return get()
      .messages.filter((message) => wanted.has(message.id))
      .map((message) => ({
        accountId: message.accountId,
        folderId: message.folderId,
        uid: message.uid
      }))
  },

  selectedMessages: () => {
    const wanted = new Set(get().selectedIds)
    return get().messages.filter((message) => wanted.has(message.id))
  }
}))
