import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  CheckCheck,
  Clock,
  ListChecks,
  CloudOff,
  Forward,
  FolderPlus,
  Mail,
  MailOpen,
  PenSquare,
  Paperclip,
  Pencil,
  RefreshCw,
  Reply,
  Search,
  Settings as SettingsIcon,
  ShieldAlert,
  Star,
  Tag as TagIcon,
  Trash2,
  X
} from 'lucide-react'
import type {
  FolderNode,
  MessageActionResult,
  MessageDetail,
  MessageRef,
  MessageSummary,
  SearchResultItem
} from '@peregrine/core/types'
import ContextMenu, {
  type ContextMenuItem,
  type ContextMenuState
} from '@renderer/components/ContextMenu'
import { toastError, toastInfo, useToastStore } from '@renderer/state/toastStore'
import { askForText } from '@renderer/state/promptStore'
import { useAccountsStore } from '@renderer/state/accountsStore'
import { useMailboxStore, viewKey, type MailboxView } from '@renderer/state/mailboxStore'
import { useConnectionStore } from '@renderer/state/connectionStore'
import { aggregateProgress, useSyncStore } from '@renderer/state/syncStore'
import { useSettingsStore } from '@renderer/state/settingsStore'
import FolderTree from '@renderer/components/FolderTree'
import MessageList from '@renderer/components/MessageList'
import MessageReader from '@renderer/components/MessageReader'
import SearchResults from '@renderer/components/SearchResults'
import SavedSearchDialog from '@renderer/components/SavedSearchDialog'
import SnoozeDialog from '@renderer/components/SnoozeDialog'
import DailyList from '@renderer/components/DailyList'
import Splitter from '@renderer/components/Splitter'
import { type ComposeInitialValues } from '@renderer/components/ComposeEditor'
import { folderLabel } from '@renderer/util/folderLabel'
import { useElementSize } from '@renderer/hooks/useElementSize'
import { useTagsStore } from '@renderer/state/tagsStore'
import { usePendingStore } from '@renderer/state/pendingStore'
import { useTasksStore } from '@renderer/state/tasksStore'
import CommandPalette, { type Command } from '@renderer/components/CommandPalette'
import {
  matchesShortcut,
  parseShortcuts,
  SHORTCUT_ACTIONS,
  type ShortcutAction
} from '@peregrine/core/shortcuts'
import {
  parseSavedSearches,
  removeSavedSearch,
  serializeSavedSearches,
  suggestSavedSearchName,
  upsertSavedSearch,
  DEFAULT_SAVED_SEARCH_COLOR,
  type SavedSearch
} from '@peregrine/core/savedSearches'
import { buildForward, buildReply, buildReplyAll } from './replyHelpers'

interface MailboxProps {
  onOpenSettings: () => void
}

const SEARCH_DEBOUNCE_MS = 300
const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 480
const READER_MIN = 200
/**
 * Floor for the message list.
 *
 * Not a token gesture: below roughly this the subject and the participants stop being
 * readable at the same time, which is the entire job of the list. The reading pane gives up
 * its stored width before the list goes under this.
 *
 * Raised from 360 after seeing what 360 actually looks like: the header ran out of room and
 * broke the title over three lines while the filter buttons slid off the edge. The header
 * now copes on its own, but the list is not worth showing that narrow either.
 */
const LIST_MIN = 440

/**
 * Floor for the *height* of the list when the reading pane sits at the bottom.
 *
 * `LIST_MIN` was used for this until now, so 440. Its reasoning above is about width only,
 * subject and correspondents readable side by side and a header with enough room. Read as a
 * height, the same number meant the list claimed 440 pixels for itself no matter how tall the
 * window was. On a 900 pixel screen that left the reading pane about 400, and it could not be
 * dragged any further. The handle was at its stop with nothing saying so.
 *
 * 160 is the header plus four rows. Less is no longer a list, more is a decision that belongs
 * to the user.
 */
const LIST_MIN_HEIGHT = 160

function Mailbox({ onOpenSettings }: MailboxProps): JSX.Element {
  const { t } = useTranslation()
  const { accounts, selectedAccountId, select } = useAccountsStore()
  const connectionStates = useConnectionStore((s) => s.states)
  const syncRunning = useSyncStore((s) => s.running)
  const syncProgress = useSyncStore((s) => s.progress)
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.update)
  const setLocalSettings = useSettingsStore((s) => s.setLocal)
  const shortcuts = useMemo(() => parseShortcuts(settings.shortcuts), [settings.shortcuts])
  const savedSearches = useMemo(
    () => parseSavedSearches(settings.savedSearches),
    [settings.savedSearches]
  )
  const tags = useTagsStore((s) => s.tags)
  const pending = usePendingStore((s) => s.summary)
  const dailyList = useTasksStore((s) => s.list)
  const loadTasks = useTasksStore((s) => s.load)
  const discardFailed = usePendingStore((s) => s.discardFailed)
  const {
    folders,
    view,
    messages,
    totalCount,
    filter,
    selectedIds,
    snoozedCount,
    loadSnoozedCount,
    loadFolders,
    setView,
    loadMessages,
    setFilter,
    setSelection,
    refsFor,
    selectedMessages,
    foldersError,
    messagesError,
    loadingMessages
  } = useMailboxStore()

  const openTaskCount = dailyList.tasks.filter((task) => !task.done).length

  const [openMessageDetail, setOpenMessageDetail] = useState<MessageDetail | null>(null)
  const [loadingMessage, setLoadingMessage] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResultItem[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  /** The saved search being created or edited; the editor is open while this is set. */
  const [searchDraft, setSearchDraft] = useState<SavedSearch | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  /** The "remind me later" dialog; it acts on whatever is selected when it opens. */
  const [snoozeOpen, setSnoozeOpen] = useState(false)
  /** Ids picked up by a drag, so a drop on a folder knows what to move. */
  const draggedIds = useRef<string[]>([])
  const searchInputRef = useRef<HTMLInputElement>(null)
  const markReadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const syncWasRunning = useRef(false)

  useEffect(() => {
    void loadFolders()
    void useTagsStore.getState().load()
    // Read once for the sidebar count; the view itself reloads when it opens.
    void loadTasks()
  }, [])

  useEffect(() => {
    if (view) {
      void loadMessages()
      setOpenMessageDetail(null)
    }
  }, [viewKey(view), folders.length])

  // Clicking a desktop notification jumps straight to that message, switching folders if needed.
  useEffect(() => {
    return window.peregrine.events.onNotificationActivated(async (ref) => {
      const { folders: known, setView: switchView } = useMailboxStore.getState()
      const folder = known.find((f) => f.id === ref.folderId)
      if (folder) switchView({ kind: 'folder', folderId: folder.id })
      try {
        const detail = await window.peregrine.messages.get(ref)
        setOpenMessageDetail(detail)
        setSelection([detail.id], detail.id)
      } catch (err) {
        toastError(err, t('mailbox.openFailed'))
      }
    })
  }, [])

  useEffect(() => {
    const offScheduled = window.peregrine.events.onSendScheduled(({ pendingId }) =>
      offerUndoSend(pendingId)
    )
    // Failed, but not lost: it is in the queue and goes out on the next connection. Saying
    // only "sending failed" would read as "gone".
    const offFailed = window.peregrine.events.onSendFailed(({ message }) =>
      toastError(new Error(message), t('compose.sendQueued'))
    )
    return () => {
      offScheduled()
      offFailed()
    }
  }, [settings.undoSendSeconds])

  // Progress of manual and scheduled refreshes drives the topbar indicator; when a round
  // finishes, the folder counts and the visible page are re-read.
  useEffect(() => {
    const unsubscribe = useSyncStore.getState().subscribe()
    return unsubscribe
  }, [])

  // Only on the falling edge: a round that has just ended may have brought in new mail. On
  // mount there is nothing to catch up on. The view effect above already loads the page.
  useEffect(() => {
    if (syncRunning) {
      syncWasRunning.current = true
      return
    }
    if (!syncWasRunning.current) return
    syncWasRunning.current = false
    void loadFolders()
    void loadMessages(false, { sync: false })
  }, [syncRunning])

  // New mail for a folder that is currently on screen should just appear.
  useEffect(() => {
    return window.peregrine.events.onMailNew(({ folderId }) => {
      const inView = useMailboxStore
        .getState()
        .targets()
        .some((target) => target.folderId === folderId)
      if (inView) void loadMessages()
      void loadFolders()
    })
  }, [])

  // A reminder came due in the main process: the message is back in its folder, so whatever
  // is on screen has to be read again.
  useEffect(() => {
    return window.peregrine.events.onSnoozeDue(() => {
      void loadMessages(false, { sync: false })
      void loadSnoozedCount()
    })
  }, [])

  useEffect(() => {
    void usePendingStore.getState().load()
    return window.peregrine.events.onPendingActions((summary) => {
      usePendingStore.getState().set(summary)
      // The queue has just changed things on the server; the list may have been catching up
      // with a state that is now out of date.
      void loadMessages(false, { sync: false })
    })
  }, [])

  useEffect(() => {
    if (searchQuery.trim() === '') {
      setSearchResults(null)
      return
    }
    setSearching(true)
    const handle = setTimeout(() => {
      // No accountIds: search spans every mailbox, which is what a global search bar implies.
      window.peregrine.search.messages({ query: searchQuery, limit: 80 }).then((results) => {
        setSearchResults(results)
        setSearching(false)
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [searchQuery])

  /**
   * Panel sizes that fit the window, not just the stored numbers.
   *
   * The stored width is what the user dragged to, possibly in a much larger window. Applying
   * it unchanged in a smaller one pushes the message list off the edge. The list does not
   * shrink, it gets covered. Clamping happens on display only: the stored value is left
   * alone, so making the window big again restores the size that was chosen.
   */
  const [bodyRef, bodySize] = useElementSize<HTMLDivElement>()
  const readerReserve =
    settings.readerPosition === 'right' ? Math.min(settings.readerPaneWidth, READER_MIN) : 0
  const sidebarMax =
    bodySize.width > 0
      ? Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, bodySize.width - LIST_MIN - readerReserve - 5))
      : SIDEBAR_MAX
  const sidebarWidth = Math.min(settings.sidebarWidth, sidebarMax)

  /** What is left for the main area once the sidebar has had its share. */
  const mainWidth = Math.max(0, bodySize.width - sidebarWidth - 5)
  const readerWidthMax = Math.max(READER_MIN, mainWidth - LIST_MIN - 5)
  const readerPaneWidth = Math.min(settings.readerPaneWidth, readerWidthMax)
  const readerHeightMax = Math.max(READER_MIN, bodySize.height - LIST_MIN_HEIGHT - 5)
  const readerPaneHeight = Math.min(settings.readerPaneHeight, readerHeightMax)

  const activeMessages = selectedMessages()
  const activeRefs: MessageRef[] = refsFor(selectedIds)
  const readerAccountId = openMessageDetail?.accountId ?? selectedAccountId
  const moveTargets = folders.filter((folder) => folder.accountId === readerAccountId)

  /**
   * Everything the palette can run.
   *
   * Folders are commands too: jumping to one by name is the thing a keyboard-first user
   * reaches for most, and it needs no separate mode to do it.
   */
  const paletteCommands: Command[] = [
    { id: 'compose', label: t('mailbox.newMessage'), icon: PenSquare, run: () => openCompose({}) },
    { id: 'sync', label: t('mailbox.syncAll'), icon: RefreshCw, run: () => void handleSyncAll() },
    { id: 'search', label: t('settings.shortcutAction.search'), icon: Search, run: () => searchInputRef.current?.focus() },
    { id: 'settings', label: t('settings.title'), icon: SettingsIcon, run: onOpenSettings },
    { id: 'reply', label: t('mailbox.reply'), icon: Reply, hint: shortcuts.reply, run: () => composeReply('reply') },
    { id: 'replyAll', label: t('mailbox.replyAll'), icon: Reply, hint: shortcuts.replyAll, run: () => composeReply('replyAll') },
    { id: 'forward', label: t('mailbox.forward'), icon: Forward, hint: shortcuts.forward, run: () => composeReply('forward') },
    { id: 'archive', label: t('mailbox.archive'), icon: Archive, hint: shortcuts.archive, run: () => void handleArchive() },
    { id: 'junk', label: t('mailbox.junk'), icon: ShieldAlert, hint: shortcuts.junk, run: () => void handleJunk() },
    { id: 'delete', label: t('mailbox.delete'), icon: Trash2, hint: shortcuts.delete, run: () => void handleDelete() },
    { id: 'markUnread', label: t('mailbox.markUnread'), icon: Mail, hint: shortcuts.markUnread, run: () => void handleMarkUnread() },
    { id: 'snooze', label: t('snooze.action'), icon: Clock, run: () => setSnoozeOpen(true) },
    ...(snoozedCount > 0
      ? [
          {
            id: 'snoozedFolder',
            label: t('snooze.folder'),
            icon: Clock,
            hint: String(snoozedCount),
            run: () => setView({ kind: 'snoozed' })
          }
        ]
      : []),
    ...savedSearches.map((search) => ({
      id: `search-${search.id}`,
      label: search.name,
      hint: search.query,
      icon: Search,
      run: () => setView({ kind: 'search', searchId: search.id })
    })),
    ...folders.map((folder) => ({
      id: `folder-${folder.id}`,
      label: folderLabel(folder, t),
      hint: accounts.find((a) => a.id === folder.accountId)?.emailAddress,
      icon: FolderPlus,
      run: () => setView({ kind: 'folder', folderId: folder.id })
    })),
    ...tags.map((tag) => ({
      id: `palette-tag-${tag.id}`,
      label: t('mailbox.addTag', { name: tag.name }),
      icon: TagIcon,
      run: () => void handleSetTag(tag.id, true)
    }))
  ]

  async function refresh(): Promise<void> {
    await loadMessages()
    await loadFolders()
  }

  const syncTotals = aggregateProgress(syncProgress)
  const syncLabel = syncRunning
    ? syncTotals.total > 0
      ? t('mailbox.syncProgress', { current: syncTotals.current, total: syncTotals.total })
      : t('mailbox.syncRunning')
    : t('mailbox.syncAll')

  /**
   * Offers to call a message back while it is still waiting.
   *
   * The toast lives as long as the grace period, so it disappears exactly when the option
   * does. A button that quietly stops working would be worse than none.
   */
  function offerUndoSend(pendingId: string): void {
    const seconds = settings.undoSendSeconds
    useToastStore.getState().show(
      {
        kind: 'info',
        message: t('compose.sentWithUndo', { count: seconds }),
        action: {
          label: t('mailbox.undo'),
          run: async () => {
            const { cancelled } = await window.peregrine.compose.cancelSend({ pendingId })
            toastInfo(cancelled ? t('compose.sendCancelled') : t('compose.sendAlreadyGone'))
          }
        }
      },
      seconds * 1000
    )
  }

  async function handleSetTag(tagId: string, apply: boolean): Promise<void> {
    try {
      const refs = actionRefs()
      if (refs.length === 0) return
      await window.peregrine.tags.setOnMessages({ refs, tagId, apply })
      await loadMessages(false, { sync: false })
    } catch (err) {
      toastError(err, t('mailbox.tagFailed'))
    }
  }

  async function handleSyncAll(): Promise<void> {
    try {
      const syncedFolders = await useSyncStore.getState().syncAll()
      toastInfo(t('mailbox.syncDone', { count: syncedFolders }))
    } catch (err) {
      toastError(err, t('mailbox.syncFailed'))
    }
    await refresh()
  }

  /**
   * Reads the open message again, keeping everything else as it is.
   *
   * Not `openMessage`: that one also selects the account and starts the mark-as-read timer,
   * neither of which belongs here. Nothing is fetched from the server either. The raw
   * source is stored, and only the verdict on it (decryption, signature) is recomputed.
   */
  async function reloadOpenMessage(): Promise<void> {
    const current = openMessageDetail
    if (!current) return
    try {
      const detail = await window.peregrine.messages.get({
        accountId: current.accountId,
        folderId: current.folderId,
        uid: current.uid
      })
      // The user may have moved on while this was running; a late answer must not put a
      // different message back on screen.
      setOpenMessageDetail((shown) =>
        shown && shown.id === detail.id ? detail : shown
      )
    } catch (err) {
      toastError(err, t('mailbox.openFailed'))
    }
  }

  /**
   * Opens a message the daily list points at.
   *
   * The list only carries account, folder and uid. It has no summary to hand over, and a
   * task may well outlive the row it was made from.
   */
  async function openMessageByRef(ref: {
    accountId: string
    folderId: string
    uid: number
  }): Promise<void> {
    setLoadingMessage(true)
    try {
      setOpenMessageDetail(await window.peregrine.messages.get(ref))
    } catch (err) {
      toastError(err, t('mailbox.openFailed'))
    } finally {
      setLoadingMessage(false)
    }
  }

  /**
   * Puts a message on today's list, keeping the way back to it.
   *
   * Takes the message the menu was opened on rather than reading the selection: the two are
   * not the same at the moment of the right-click, because the click that selects and the
   * menu that opens happen in the same breath and React has not re-rendered in between.
   */
  async function addMessageToToday(message: MessageSummary | MessageDetail): Promise<void> {
    const subject = message.subject || t('mailbox.noSubject')
    try {
      await useTasksStore.getState().create({
        title: subject,
        link: {
          accountId: message.accountId,
          folderId: message.folderId,
          uid: message.uid,
          messageIdHeader: message.messageIdHeader
        }
      })
      toastInfo(t('daily.added'))
    } catch (err) {
      toastError(err, t('daily.addFailed'))
    }
  }

  async function openMessage(message: MessageSummary): Promise<void> {
    setLoadingMessage(true)
    select(message.accountId)
    if (markReadTimer.current) clearTimeout(markReadTimer.current)
    try {
      const detail = await window.peregrine.messages.get({
        accountId: message.accountId,
        folderId: message.folderId,
        uid: message.uid
      })

      // A draft is not something to read. It is something to keep writing.
      const folder = folders.find((f) => f.id === message.folderId)
      if (folder?.specialUse === 'drafts') {
        setLoadingMessage(false)
        openCompose(
          {
            to: detail.to.map((a) => a.address).join(', '),
            cc: detail.cc.map((a) => a.address).join(', '),
            subject: detail.subject,
            htmlBody: detail.htmlBody ?? undefined,
            textBody: detail.htmlBody ? undefined : (detail.textBody ?? undefined),
            draftUid: detail.uid
          },
          message.accountId
        )
        return
      }

      setOpenMessageDetail(detail)

      if (!message.isRead && settings.markReadDelayMs >= 0) {
        const markRead = async (): Promise<void> => {
          await window.peregrine.messages.markRead({
            refs: [
              { accountId: message.accountId, folderId: message.folderId, uid: message.uid }
            ],
            read: true
          })
          await refresh()
        }
        if (settings.markReadDelayMs === 0) await markRead()
        else markReadTimer.current = setTimeout(() => void markRead(), settings.markReadDelayMs)
      }
    } catch (err) {
      toastError(err, t('mailbox.openFailed'))
    } finally {
      setLoadingMessage(false)
    }
  }

  function handleSelectSearchResult(item: SearchResultItem): void {
    setSearchQuery('')
    setSearchResults(null)
    setView({ kind: 'folder', folderId: item.folderId })
    setSelection([item.id], item.id)
    void openMessage(item)
  }

  async function persistSavedSearches(next: SavedSearch[]): Promise<void> {
    await updateSettings({ savedSearches: serializeSavedSearches(next) })
  }

  /**
   * Turns what is in the search bar into a sidebar entry.
   *
   * Stored as the text that was typed, not as its parsed result: it stays readable and
   * editable, and it keeps meaning what was written even if the syntax gains operators later.
   */
  function saveCurrentSearch(): void {
    const query = searchQuery.trim()
    if (!query) return
    setSearchDraft({
      id: crypto.randomUUID(),
      name: suggestSavedSearchName(query),
      query,
      color: DEFAULT_SAVED_SEARCH_COLOR,
      accountIds: [],
      includeTrash: false
    })
  }

  /** Save from the editor. For a new entry and for an edited one alike. */
  async function commitSavedSearch(entry: SavedSearch): Promise<void> {
    setSearchDraft(null)
    const isNew = !savedSearches.some((search) => search.id === entry.id)
    // Persist before switching: the view resolves its query from the stored settings, so a
    // search that is not saved yet would open as an empty list.
    await persistSavedSearches(upsertSavedSearch(savedSearches, entry))
    if (isNew) {
      setSearchQuery('')
      setSearchResults(null)
      setView({ kind: 'search', searchId: entry.id })
    } else if (viewKey(view) === `search:${entry.id}`) {
      // The query or its reach may have changed under the list that is on screen.
      await loadMessages(false, { sync: false })
    }
  }

  /**
   * Lists what is scheduled and offers to call it back.
   *
   * A context menu rather than a dialog: the entries are one line each and the only action
   * is "not after all", which is exactly what a menu is for.
   */
  async function showScheduled(): Promise<void> {
    try {
      const scheduled = await window.peregrine.messages.pendingScheduled()
      if (scheduled.length === 0) return
      const when = (at: number): string =>
        new Intl.DateTimeFormat(undefined, {
          weekday: 'short',
          hour: '2-digit',
          minute: '2-digit'
        }).format(new Date(at))

      setContextMenu({
        x: window.innerWidth - 340,
        y: 44,
        items: scheduled.map((entry) => ({
          id: String(entry.id),
          label: `${when(entry.dueAt)} · ${entry.subject || t('mailbox.noSubject')}`,
          hint: t('pending.cancelSend'),
          icon: Clock,
          run: async () => {
            usePendingStore.getState().set(await window.peregrine.messages.pendingCancel(entry.id))
            toastInfo(t('pending.cancelled'))
          }
        }))
      })
    } catch (err) {
      toastError(err, t('pending.scheduledFailed'))
    }
  }

  /**
   * Lists what is queued for the next connection and offers to drop it.
   *
   * Same shape as the scheduled list, for the same reason: one line per entry and one thing
   * to do with it. Dropping a queued move also takes the mark off its messages, so the list
   * stops claiming they are on their way somewhere.
   */
  async function showWaiting(): Promise<void> {
    try {
      const waiting = (await window.peregrine.messages.pendingWaiting()).filter(
        (entry) => entry.kind !== 'send'
      )
      if (waiting.length === 0) return

      setContextMenu({
        x: window.innerWidth - 340,
        y: 44,
        items: waiting.map((entry) => ({
          id: String(entry.id),
          label:
            entry.kind === 'move'
              ? t('pending.entryMove', { count: entry.messageCount, folder: entry.targetFolder })
              : t(`pending.entry.${entry.kind}`, { count: entry.messageCount }),
          hint: t('pending.cancelAction'),
          icon: CloudOff,
          run: async () => {
            usePendingStore.getState().set(await window.peregrine.messages.pendingCancel(entry.id))
            // The list shows a queued move as a mark on the row, so it has to be re-read.
            // Without a sync: nothing changed on the server, only here.
            await loadMessages(false, { sync: false })
            toastInfo(t('pending.cancelled'))
          }
        }))
      })
    } catch (err) {
      toastError(err, t('pending.waitingFailed'))
    }
  }

  /** Falls back to an inbox. Used when the folder currently on screen ceases to exist. */
  function leaveDeletedView(): void {
    const inboxes = folders.filter((folder) => folder.specialUse === 'inbox')
    if (settings.unifiedFolders && inboxes.length > 1) setView({ kind: 'unified', specialUse: 'inbox' })
    else if (inboxes[0]) setView({ kind: 'folder', folderId: inboxes[0].id })
  }

  function savedSearchMenuItems(search: SavedSearch): ContextMenuItem[] {
    return [
      {
        id: 'open',
        label: t('savedSearch.open'),
        icon: Search,
        run: () => setView({ kind: 'search', searchId: search.id })
      },
      {
        id: 'edit',
        label: t('savedSearch.edit'),
        icon: Pencil,
        run: () => setSearchDraft(search)
      },
      {
        id: 'includeTrash',
        label: search.includeTrash ? t('savedSearch.excludeTrash') : t('savedSearch.includeTrash'),
        icon: Trash2,
        run: () => {
          void persistSavedSearches(
            upsertSavedSearch(savedSearches, { ...search, includeTrash: !search.includeTrash })
          ).then(() => loadMessages(false, { sync: false }))
        }
      },
      {
        id: 'delete',
        label: t('savedSearch.delete'),
        icon: Trash2,
        separatorBefore: true,
        run: () => {
          // Only the question goes away, never mail: a saved search holds no messages.
          void persistSavedSearches(removeSavedSearch(savedSearches, search.id))
          if (viewKey(view) === `search:${search.id}`) leaveDeletedView()
        }
      }
    ]
  }

  /** Turns an undo plan from the main process into a toast the user can act on. */
  function offerUndo(result: MessageActionResult, message: string): void {
    const undo = result.undo
    if (!undo) {
      toastInfo(message)
      return
    }
    toastInfo(message, {
      label: t('mailbox.undo'),
      run: async () => {
        try {
          for (const entry of undo) {
            await window.peregrine.messages.move({
              refs: entry.uids.map((uid) => ({
                accountId: entry.accountId,
                folderId: entry.folderId,
                uid
              })),
              targetFolderId: entry.targetFolderId
            })
          }
          await refresh()
        } catch (err) {
          toastError(err, t('mailbox.undoFailed'))
        }
      }
    })
  }

  /** Actions operate on the list selection, falling back to the message in the reader. */
  /**
   * The messages an action applies to, read at the moment it runs.
   *
   * Deliberately not the `activeRefs` of the surrounding render: a context menu is built in
   * the same tick that its right-click sets the selection, so its handlers would close over
   * the selection as it was *before* the click. And act on the previously selected message
   * instead of the one under the cursor.
   */
  function actionRefs(): MessageRef[] {
    const state = useMailboxStore.getState()
    const current = state.refsFor(state.selectedIds)
    if (current.length > 0) return current
    if (!openMessageDetail) return []
    return [
      {
        accountId: openMessageDetail.accountId,
        folderId: openMessageDetail.folderId,
        uid: openMessageDetail.uid
      }
    ]
  }

  /**
   * Every mailbox action funnels through here: it resolves the target messages, reports
   * failures as a toast instead of a silent console error, and refreshes the view.
   */
  async function runOnSelection<T>(
    action: (refs: MessageRef[]) => Promise<T>,
    options: { closeReader?: boolean; errorKey: string; onDone?: (result: T, count: number) => void }
  ): Promise<void> {
    const refs = actionRefs()
    if (refs.length === 0) return
    try {
      const result = await action(refs)
      if (options.closeReader !== false) {
        setOpenMessageDetail(null)
        setSelection([], null)
      }
      await refresh()
      options.onDone?.(result, refs.length)
    } catch (err) {
      toastError(err, t(options.errorKey))
    }
  }

  const handleDelete = (): Promise<void> =>
    runOnSelection((refs) => window.peregrine.messages.delete({ refs }), {
      errorKey: 'mailbox.deleteFailed',
      onDone: (result, count) => offerUndo(result, t('mailbox.movedToTrash', { count }))
    })

  const handleArchive = (): Promise<void> =>
    runOnSelection((refs) => window.peregrine.messages.archive({ refs }), {
      errorKey: 'mailbox.archiveFailed',
      onDone: (result, count) =>
        result.movedCount === 0
          ? toastError(new Error(t('mailbox.noArchiveFolder')), t('mailbox.archiveFailed'))
          : offerUndo(result, t('mailbox.archived', { count }))
    })

  /**
   * Puts the selection aside, or brings it back when `until` is null.
   *
   * The toast names the time and the place: a message that vanishes from the inbox without
   * saying where it went is indistinguishable from one that was lost.
   */
  const handleSnooze = (until: number | null): Promise<void> =>
    runOnSelection((refs) => window.peregrine.messages.snooze({ refs, until }), {
      errorKey: 'snooze.failed',
      onDone: (_result, count) => {
        void loadSnoozedCount()
        if (until === null) {
          toastInfo(t('snooze.broughtBack', { count }))
          return
        }
        toastInfo(
          t('snooze.done', {
            count,
            when: new Intl.DateTimeFormat(undefined, {
              weekday: 'short',
              hour: '2-digit',
              minute: '2-digit'
            }).format(new Date(until))
          })
        )
      }
    })

  const handleJunk = (): Promise<void> =>
    runOnSelection((refs) => window.peregrine.messages.junk({ refs }), {
      errorKey: 'mailbox.junkFailed',
      onDone: (result, count) =>
        result.movedCount === 0
          ? toastError(new Error(t('mailbox.noJunkFolder')), t('mailbox.junkFailed'))
          : offerUndo(result, t('mailbox.markedAsJunk', { count }))
    })

  const handleMarkUnread = (): Promise<void> =>
    runOnSelection((refs) => window.peregrine.messages.markRead({ refs, read: false }), {
      errorKey: 'mailbox.markUnreadFailed'
    })

  const handleMarkRead = (): Promise<void> =>
    runOnSelection((refs) => window.peregrine.messages.markRead({ refs, read: true }), {
      closeReader: false,
      errorKey: 'mailbox.markReadFailed'
    })

  async function handleMoveTo(targetFolderId: string): Promise<void> {
    if (!targetFolderId) return
    await runOnSelection((refs) => window.peregrine.messages.move({ refs, targetFolderId }), {
      errorKey: 'mailbox.moveFailed',
      onDone: (result, count) => offerUndo(result, t('mailbox.moved', { count }))
    })
  }

  async function handleToggleFlag(message: MessageSummary): Promise<void> {
    try {
      await window.peregrine.messages.setFlagged({
        refs: [{ accountId: message.accountId, folderId: message.folderId, uid: message.uid }],
        flagged: !message.isFlagged
      })
      await loadMessages()
    } catch (err) {
      toastError(err, t('mailbox.flagFailed'))
    }
  }

  async function handleToggleFlagSelection(): Promise<void> {
    const refs = actionRefs()
    if (refs.length === 0) return
    const allFlagged = activeMessages.length > 0 && activeMessages.every((m) => m.isFlagged)
    try {
      await window.peregrine.messages.setFlagged({ refs, flagged: !allFlagged })
      await loadMessages()
    } catch (err) {
      toastError(err, t('mailbox.flagFailed'))
    }
  }

  function openCompose(seed: ComposeInitialValues, forAccountId?: string): void {
    void window.peregrine.compose
      .openWindow({ accountId: forAccountId ?? readerAccountId ?? accounts[0]?.id ?? '', ...seed })
      .catch((err) => toastError(err, t('compose.openFailed')))
  }

  function composeReply(kind: 'reply' | 'replyAll' | 'forward'): void {
    if (!openMessageDetail) return
    const ownAddress = accounts.find((a) => a.id === openMessageDetail.accountId)?.emailAddress
    const seed =
      kind === 'reply'
        ? buildReply(openMessageDetail)
        : kind === 'replyAll'
          ? buildReplyAll(openMessageDetail, ownAddress)
          : buildForward(openMessageDetail)
    openCompose(seed, openMessageDetail.accountId)
  }

  function messageMenuItems(message: MessageSummary): ContextMenuItem[] {
    const count = Math.max(1, selectedIds.length)
    return [
      { id: 'open', label: t('mailbox.open'), icon: MailOpen, run: () => void openMessage(message) },
      { id: 'reply', label: t('mailbox.reply'), icon: Reply, run: () => composeReply('reply') },
      { id: 'forward', label: t('mailbox.forward'), icon: Forward, run: () => composeReply('forward') },
      {
        id: 'read',
        label: message.isRead ? t('mailbox.markUnread') : t('mailbox.markRead'),
        icon: Mail,
        separatorBefore: true,
        run: () => void (message.isRead ? handleMarkUnread() : handleMarkRead())
      },
      {
        id: 'flag',
        label: t('mailbox.toggleFlag'),
        icon: Star,
        run: () => void handleToggleFlagSelection()
      },
      // One entry per tag, showing whether this message already carries it. Toggling acts on
      // the whole selection, like every other action in this menu.
      ...tags.map((tag, index) => ({
        id: `tag-${tag.id}`,
        label: message.tagKeywords.includes(tag.keyword)
          ? t('mailbox.removeTag', { name: tag.name })
          : t('mailbox.addTag', { name: tag.name }),
        icon: TagIcon,
        separatorBefore: index === 0,
        run: () => void handleSetTag(tag.id, !message.tagKeywords.includes(tag.keyword))
      })),
      {
        id: 'today',
        label: t('daily.addToToday'),
        icon: ListChecks,
        separatorBefore: true,
        run: () => void addMessageToToday(message)
      },
      message.snoozedUntil
        ? {
            id: 'unsnooze',
            label: t('snooze.back'),
            icon: Clock,
            separatorBefore: true,
            run: () => void handleSnooze(null)
          }
        : {
            id: 'snooze',
            label: t('snooze.action'),
            icon: Clock,
            separatorBefore: true,
            run: () => setSnoozeOpen(true)
          },
      {
        id: 'archive',
        label: t('mailbox.archive'),
        icon: Archive,
        separatorBefore: true,
        run: () => void handleArchive()
      },
      { id: 'junk', label: t('mailbox.junk'), icon: ShieldAlert, run: () => void handleJunk() },
      {
        id: 'delete',
        label: t('mailbox.deleteCount', { count }),
        icon: Trash2,
        danger: true,
        run: () => void handleDelete()
      }
    ]
  }

  function folderMenuItems(folder: FolderNode): ContextMenuItem[] {
    return [
      {
        id: 'markAllRead',
        label: t('mailbox.markFolderRead'),
        icon: CheckCheck,
        run: () => void runFolderAction(() => window.peregrine.folders.markAllRead({ folderId: folder.id }))
      },
      {
        id: 'newSubfolder',
        label: t('mailbox.newSubfolder'),
        icon: FolderPlus,
        separatorBefore: true,
        run: async () => {
          const name = await askForText({ title: t('mailbox.folderNamePrompt') })
          if (!name) return
          await runFolderAction(() =>
            window.peregrine.folders.create({
              accountId: folder.accountId,
              parentFolderId: folder.id,
              name
            })
          )
        }
      },
      {
        id: 'rename',
        label: t('mailbox.renameFolder'),
        icon: Pencil,
        disabled: folder.specialUse !== null,
        run: async () => {
          const name = await askForText({
            title: t('mailbox.folderNamePrompt'),
            defaultValue: folder.displayName
          })
          if (!name || name === folder.displayName) return
          await runFolderAction(() => window.peregrine.folders.rename({ folderId: folder.id, name }))
        }
      },
      {
        id: 'delete',
        label: t('mailbox.deleteFolder'),
        icon: Trash2,
        danger: true,
        disabled: folder.specialUse !== null,
        run: () => {
          if (!window.confirm(t('mailbox.confirmDeleteFolder', { name: folder.displayName }))) return
          void runFolderAction(() => window.peregrine.folders.delete({ folderId: folder.id }))
        }
      },
      ...(folder.specialUse === 'trash'
        ? [
            {
              id: 'emptyTrash',
              label: t('mailbox.emptyTrash'),
              icon: Trash2,
              danger: true,
              separatorBefore: true,
              run: () => {
                if (!window.confirm(t('mailbox.confirmEmptyTrash'))) return
                void runFolderAction(() =>
                  window.peregrine.folders.emptyTrash({ accountId: folder.accountId })
                )
              }
            } as ContextMenuItem
          ]
        : [])
    ]
  }

  async function runFolderAction(action: () => Promise<unknown>): Promise<void> {
    try {
      await action()
      await refresh()
    } catch (err) {
      toastError(err, t('mailbox.folderActionFailed'))
    }
  }

  async function handleDropOnFolder(folder: FolderNode): Promise<void> {
    const ids = draggedIds.current
    if (ids.length === 0) return
    draggedIds.current = []
    const refs = refsFor(ids)
    if (refs.length === 0) return
    try {
      const result = await window.peregrine.messages.move({ refs, targetFolderId: folder.id })
      setOpenMessageDetail(null)
      setSelection([], null)
      await refresh()
      offerUndo(result, t('mailbox.moved', { count: refs.length }))
    } catch (err) {
      toastError(err, t('mailbox.moveFailed'))
    }
  }

  /** Where a shift-extended run started. See `moveActiveTo`. */
  const selectionAnchor = useRef<string | null>(null)

  function activeIndex(): number {
    return messages.findIndex((message) => message.id === useMailboxStore.getState().activeId)
  }

  /** Moves the active row by one, opening the message it lands on. */
  function stepSelection(delta: number): void {
    if (messages.length === 0) return
    const current = activeIndex()
    moveActiveTo((current === -1 ? 0 : current) + delta, false)
  }

  /**
   * Moves the active row to a given index, optionally taking everything in between with it.
   *
   * The extending form is what shift-arrow does everywhere else and what the list already
   * did with shift-click. Doing it from the keyboard was the piece missing: selecting eleven
   * of twelve messages needed the mouse.
   */
  function moveActiveTo(index: number, extend: boolean): void {
    if (messages.length === 0) return
    const target = Math.min(messages.length - 1, Math.max(0, index))
    const next = messages[target]

    if (!extend) {
      // Where the next run would start from. Held apart from the active row, which moves with
      // every step: reading the anchor off the active row would drag it along, and a second
      // shift-arrow would then select two rows instead of three.
      selectionAnchor.current = next.id
      setSelection([next.id], next.id)
      void openMessage(next)
      return
    }

    const anchorIndex = messages.findIndex((message) => message.id === selectionAnchor.current)
    const from = Math.min(anchorIndex === -1 ? target : anchorIndex, target)
    const to = Math.max(anchorIndex === -1 ? target : anchorIndex, target)
    const ids = messages.slice(from, to + 1).map((message) => message.id)
    // Extending deliberately opens nothing: the reading pane would follow every step and
    // fetch a body per keypress.
    setSelection(ids, next.id)
  }

  useEffect(() => {
    function handleKey(event: KeyboardEvent): void {
      const target = event.target as HTMLElement | null
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)

      // Deliberately not configurable: a palette that cannot be found is no palette, and this
      // is the combination every editor uses for it.
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        setPaletteOpen(true)
        return
      }

      /**
       * The keys a list is expected to answer to, deliberately not configurable.
       *
       * Home, End and the page keys mean the same thing in every list there has ever been,
       * and shift with an arrow extends a selection everywhere. Rebinding those would be a
       * setting nobody wants and a surprise for everybody who tries them.
       */
      if (!typing && messages.length > 0) {
        const page = 10
        const current = activeIndex()
        const from = current === -1 ? 0 : current
        const jumps: Record<string, number | undefined> = {
          Home: 0,
          End: messages.length - 1,
          PageUp: from - page,
          PageDown: from + page
        }
        const jump = jumps[event.key]
        if (jump !== undefined) {
          event.preventDefault()
          moveActiveTo(jump, event.shiftKey)
          return
        }
        if (event.shiftKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
          event.preventDefault()
          moveActiveTo(from + (event.key === 'ArrowDown' ? 1 : -1), true)
          return
        }
      }

      const runners: Record<ShortcutAction, () => void> = {
        nextMessage: () => stepSelection(1),
        previousMessage: () => stepSelection(-1),
        reply: () => composeReply('reply'),
        replyAll: () => composeReply('replyAll'),
        forward: () => composeReply('forward'),
        archive: () => void handleArchive(),
        junk: () => void handleJunk(),
        delete: () => void handleDelete(),
        markUnread: () => void handleMarkUnread(),
        search: () => searchInputRef.current?.focus()
      }

      for (const action of SHORTCUT_ACTIONS) {
        if (!matchesShortcut(shortcuts[action], event)) continue
        // Search stays reachable while typing. It is how you get *to* the search field.
        // Everything else would fire mid-word in a text box.
        if (typing && action !== 'search') return
        event.preventDefault()
        runners[action]()
        return
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [messages, openMessageDetail, selectedIds, shortcuts])

  const currentFolder = view?.kind === 'folder' ? folders.find((f) => f.id === view.folderId) : null
  const currentSearch =
    view?.kind === 'search' ? savedSearches.find((s) => s.id === view.searchId) : undefined
  const viewTitle =
    view?.kind === 'unified'
      ? `${t('mailbox.unified')} · ${t(`mailbox.specialUse.${view.specialUse}`)}`
      : view?.kind === 'snoozed'
        ? t('snooze.folder')
        : currentSearch
        ? currentSearch.name
        : currentFolder
          ? folderLabel(currentFolder, t)
          : t('mailbox.noFolders')
  const showAccountColors = view?.kind === 'unified'
  const readerFlagged = activeMessages.some((message) => message.isFlagged)
  // With the preview pane switched off, opening a message takes over the whole pane instead.
  const readerFullPane =
    settings.readerPosition === 'hidden' && (openMessageDetail !== null || loadingMessage)

  const readerPane = (
    <section className="mailbox-reader">
      {readerFullPane && (
        <button className="reader-back-button" onClick={() => setOpenMessageDetail(null)}>
          <X size={14} strokeWidth={1.75} />
          {t('mailbox.backToList')}
        </button>
      )}
      <MessageReader
        message={openMessageDetail}
        loading={loadingMessage}
        moveTargets={moveTargets}
        flagged={readerFlagged}
        actions={{
          onReply: () => composeReply('reply'),
          onReplyAll: () => composeReply('replyAll'),
          onForward: () => composeReply('forward'),
          onArchive: () => void handleArchive(),
          onJunk: () => void handleJunk(),
          onDelete: () => void handleDelete(),
          onMarkUnread: () => void handleMarkUnread(),
          onToggleFlag: () => void handleToggleFlagSelection(),
          onMoveTo: (folderId) => void handleMoveTo(folderId),
          // Re-reads the open message so decryption and signature check run again, now that
          // the sender's key is there. Nothing is refetched from the server: the raw source
          // is already stored, only the verdict on it is recomputed.
          onSenderKeyStored: () => void reloadOpenMessage()
        }}
      />
    </section>
  )

  const listPane = (
    <section className="mailbox-list">
      <div className="list-header">
        <h1 className="list-title">{viewTitle}</h1>
        <span className="list-count">{t('mailbox.messageCount', { count: totalCount })}</span>
        {currentSearch && (
          // What a saved search actually does is otherwise invisible: the name is chosen by the
          // user and says nothing about the query or how far it reaches. Clicking opens the
          // editor, so the place that shows the setting is the place that changes it.
          <button
            className="saved-search-chip"
            onClick={() => setSearchDraft(currentSearch)}
            aria-label={t('savedSearch.edit')}
            // The list pane can be narrow enough that the query is cut to a few characters,
            // so the full one has to be readable without opening the editor.
            title={`${currentSearch.query}\n${t('savedSearch.edit')}`}
          >
            <span className="saved-search-chip-query">{currentSearch.query}</span>
            <span className="saved-search-chip-scope">
              {currentSearch.accountIds.length === 0
                ? t('savedSearch.scopeAll')
                : t('savedSearch.scopeAccounts', { count: currentSearch.accountIds.length })}
            </span>
          </button>
        )}
        <div className="list-header-spacer" />
        <button
          className="quick-filter"
          data-active={filter.unreadOnly ? 'on' : 'off'}
          onClick={() => setFilter({ unreadOnly: !filter.unreadOnly })}
          title={t('mailbox.filterUnread')}
        >
          <Mail size={13} strokeWidth={1.75} />
          <span className="quick-filter-label">{t('mailbox.filterUnread')}</span>
        </button>
        <button
          className="quick-filter"
          data-active={filter.flaggedOnly ? 'on' : 'off'}
          onClick={() => setFilter({ flaggedOnly: !filter.flaggedOnly })}
          title={t('mailbox.filterFlagged')}
        >
          <Star size={13} strokeWidth={1.75} />
          <span className="quick-filter-label">{t('mailbox.filterFlagged')}</span>
        </button>
        <button
          className="quick-filter"
          data-active={filter.attachmentsOnly ? 'on' : 'off'}
          onClick={() => setFilter({ attachmentsOnly: !filter.attachmentsOnly })}
          title={t('mailbox.filterAttachments')}
        >
          <Paperclip size={13} strokeWidth={1.75} />
          <span className="quick-filter-label">{t('mailbox.filterAttachments')}</span>
        </button>
        <button
          className="icon-button"
          onClick={() => void refresh()}
          title={t('mailbox.refresh')}
          aria-label={t('mailbox.refresh')}
        >
          <RefreshCw size={14} strokeWidth={1.75} className={loadingMessages ? 'spinning' : ''} />
        </button>
      </div>

      {selectedIds.length > 1 && (
        <div className="bulk-action-bar">
          <span>{t('mailbox.selectedCount', { count: selectedIds.length })}</span>
          <button onClick={() => void handleMarkRead()}>
            <CheckCheck size={13} strokeWidth={1.75} />
            {t('mailbox.markRead')}
          </button>
          <button onClick={() => void handleArchive()}>
            <Archive size={13} strokeWidth={1.75} />
            {t('mailbox.archive')}
          </button>
          <button onClick={() => void handleJunk()}>
            <ShieldAlert size={13} strokeWidth={1.75} />
            {t('mailbox.junk')}
          </button>
          <button onClick={() => void handleDelete()}>
            <Trash2 size={13} strokeWidth={1.75} />
            {t('mailbox.delete')}
          </button>
          <button className="icon-button" onClick={() => setSelection([], null)}>
            <X size={13} strokeWidth={1.75} />
          </button>
        </div>
      )}

      {messagesError && <p className="wizard-error">{messagesError}</p>}

      {searchResults ? (
        <SearchResults
          results={searchResults}
          loading={searching}
          accountNameFor={(accountId) => {
            const account = accounts.find((a) => a.id === accountId)
            return account?.displayName || account?.emailAddress || ''
          }}
          onSelect={handleSelectSearchResult}
        />
      ) : (
        <MessageList
          messages={messages}
          accounts={accounts}
          showAccountColors={showAccountColors}
          onOpen={(message) => void openMessage(message)}
          onToggleFlag={(message) => void handleToggleFlag(message)}
          onDeleteRow={(message) => {
            setSelection([message.id], message.id)
            void handleDelete()
          }}
          onContextMenu={(message, x, y) =>
            setContextMenu({ x, y, items: messageMenuItems(message) })
          }
          onDragMessages={(ids) => {
            draggedIds.current = ids
          }}
          onEndReached={() => void loadMessages(true)}
        />
      )}
    </section>
  )

  return (
    <div className="mailbox-shell">
      <header className="app-topbar">
        <button className="compose-new-button" onClick={() => openCompose({})}>
          <PenSquare size={15} strokeWidth={1.75} />
          {t('mailbox.newMessage')}
        </button>
        <div className="global-search">
          <Search size={14} strokeWidth={1.75} />
          <input
            ref={searchInputRef}
            className="search-input"
            placeholder={t('mailbox.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <>
              {/* Saving is offered where the search is, not in the settings: the moment you
                  know a search is worth keeping is the moment you have just run it. */}
              <button
                className="icon-button"
                onClick={saveCurrentSearch}
                aria-label={t('savedSearch.save')}
                title={t('savedSearch.save')}
              >
                <Star size={14} strokeWidth={1.75} />
              </button>
              <button className="icon-button" onClick={() => setSearchQuery('')} aria-label={t('compose.cancel')}>
                <X size={14} strokeWidth={1.75} />
              </button>
            </>
          )}
          <kbd>Ctrl+K</kbd>
        </div>
        {/* Actions taken without a connection are otherwise invisible: they look done, and
            the only sign that they have not reached the server yet is this. */}
        {/* A message that has not gone out yet is named separately. "3 Aktionen warten" is
            true but hides the one of them the user actually cares about. */}
        {pending.byKind.send > 0 && (
          <span className="pending-chip outbox" title={t('pending.hint')}>
            <CloudOff size={13} strokeWidth={1.75} />
            {t('pending.unsent', { count: pending.byKind.send })}
          </span>
        )}
        {/* Planned, not stuck. Clicking lists what is waiting and offers to call it back.
            A scheduled message that cannot be taken back is a promise, not a plan. */}
        {pending.scheduled > 0 && (
          <button
            className="pending-chip scheduled"
            title={t('pending.scheduledHint')}
            onClick={() => void showScheduled()}
          >
            <Clock size={13} strokeWidth={1.75} />
            {t('pending.scheduled', { count: pending.scheduled })}
          </button>
        )}
        {/* Clicking lists what is queued and offers to drop it. An action taken while offline
            looks done, and until now the only way to change one's mind about a move was to
            move the message somewhere else again. */}
        {pending.total - pending.byKind.send > 0 && (
          <button
            className="pending-chip"
            title={t('pending.waitingHint')}
            onClick={() => void showWaiting()}
          >
            <CloudOff size={13} strokeWidth={1.75} />
            {t('pending.waiting', { count: pending.total - pending.byKind.send })}
          </button>
        )}
        {pending.failed > 0 && (
          <button
            className="pending-chip failed"
            title={t('pending.failedHint')}
            onClick={() => void discardFailed()}
          >
            <CloudOff size={13} strokeWidth={1.75} />
            {t('pending.failed', { count: pending.failed })}
          </button>
        )}
        <button
          className="icon-button"
          onClick={() => void handleSyncAll()}
          disabled={syncRunning}
          aria-label={t('mailbox.syncAll')}
          title={syncLabel}
        >
          <RefreshCw
            size={16}
            strokeWidth={1.75}
            className={syncRunning ? 'spinning' : undefined}
          />
        </button>
        <button
          className="icon-button"
          onClick={onOpenSettings}
          aria-label={t('settings.title')}
          title={t('settings.title')}
        >
          <SettingsIcon size={16} strokeWidth={1.75} />
        </button>
      </header>

      <div
        className="mailbox-body"
        ref={bodyRef}
        style={{ gridTemplateColumns: `${sidebarWidth}px 5px minmax(0, 1fr)` }}
      >
        <aside className="mailbox-sidebar">
          {foldersError && <p className="wizard-error">{foldersError}</p>}
          <FolderTree
            accounts={accounts}
            folders={folders}
            savedSearches={savedSearches}
            snoozedCount={snoozedCount}
            openTaskCount={openTaskCount}
            view={view}
            connectionStates={connectionStates}
            unifiedEnabled={settings.unifiedFolders}
            onSelect={(next: MailboxView) => {
              setView(next)
              if (next.kind === 'folder') {
                const folder = folders.find((f) => f.id === next.folderId)
                if (folder) select(folder.accountId)
              }
            }}
            onFolderContextMenu={(folder, x, y) =>
              setContextMenu({ x, y, items: folderMenuItems(folder) })
            }
            onSavedSearchContextMenu={(search, x, y) =>
              setContextMenu({ x, y, items: savedSearchMenuItems(search) })
            }
            onAccountContextMenu={(account, x, y) =>
              setContextMenu({
                x,
                y,
                items: [
                  {
                    id: 'newFolder',
                    label: t('mailbox.newFolder'),
                    icon: FolderPlus,
                    run: async () => {
                      const name = await askForText({ title: t('mailbox.folderNamePrompt') })
                      if (!name) return
                      await runFolderAction(() =>
                        window.peregrine.folders.create({
                          accountId: account.id,
                          parentFolderId: null,
                          name
                        })
                      )
                    }
                  },
                  {
                    id: 'settings',
                    label: t('settings.editAccount'),
                    icon: SettingsIcon,
                    separatorBefore: true,
                    run: onOpenSettings
                  }
                ]
              })
            }
            onDropMessages={(folder) => void handleDropOnFolder(folder)}
          />
        </aside>

        <Splitter
          axis="x"
          size={sidebarWidth}
          min={SIDEBAR_MIN}
          max={sidebarMax}
          onResize={(size) => setLocalSettings({ sidebarWidth: size })}
          onResizeEnd={(size) => void updateSettings({ sidebarWidth: size })}
        />

        {/* The daily list takes the whole pane. It holds tasks, not mail, so neither the
            message list nor the reading pane has anything to show beside it. */}
        {view?.kind === 'daily' ? (
          <main className="mailbox-main reader-hidden">
            <DailyList
              onOpenMail={(ref) => {
                setView({ kind: 'folder', folderId: ref.folderId })
                void openMessageByRef(ref)
              }}
            />
          </main>
        ) : (
        <main
          className={`mailbox-main reader-${settings.readerPosition}`}
          // minmax keeps the list from collapsing to nothing in a small window: the list
          // holds a floor, and the reading pane gives up its stored size when space runs out.
          style={
            settings.readerPosition === 'right'
              ? {
                  gridTemplateColumns: `minmax(${LIST_MIN}px, 1fr) 5px minmax(0, ${readerPaneWidth}px)`
                }
              : settings.readerPosition === 'bottom'
                ? {
                    gridTemplateRows: `minmax(${LIST_MIN_HEIGHT}px, 1fr) 5px minmax(0, ${readerPaneHeight}px)`
                  }
                : undefined
          }
        >
          {readerFullPane ? readerPane : listPane}
          {settings.readerPosition === 'right' && (
            <>
              <Splitter
                axis="x"
                size={readerPaneWidth}
                min={READER_MIN}
                max={readerWidthMax}
                invert
                onResize={(size) => setLocalSettings({ readerPaneWidth: size })}
                onResizeEnd={(size) => void updateSettings({ readerPaneWidth: size })}
              />
              {readerPane}
            </>
          )}
          {settings.readerPosition === 'bottom' && (
            <>
              <Splitter
                axis="y"
                size={readerPaneHeight}
                min={READER_MIN}
                max={readerHeightMax}
                invert
                onResize={(size) => setLocalSettings({ readerPaneHeight: size })}
                onResizeEnd={(size) => void updateSettings({ readerPaneHeight: size })}
              />
              {readerPane}
            </>
          )}
        </main>
        )}
      </div>

      <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />

      {paletteOpen && (
        <CommandPalette commands={paletteCommands} onClose={() => setPaletteOpen(false)} />
      )}

      {snoozeOpen && (
        <SnoozeDialog
          count={Math.max(1, selectedIds.length)}
          onChoose={(until) => {
            setSnoozeOpen(false)
            void handleSnooze(until)
          }}
          onCancel={() => setSnoozeOpen(false)}
        />
      )}

      {searchDraft && (
        <SavedSearchDialog
          draft={searchDraft}
          accounts={accounts}
          onSave={(entry) => void commitSavedSearch(entry)}
          onCancel={() => setSearchDraft(null)}
        />
      )}
    </div>
  )
}

export default Mailbox
