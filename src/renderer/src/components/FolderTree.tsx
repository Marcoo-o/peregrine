import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  ChevronRight,
  Clock,
  FileEdit,
  Folder,
  Inbox,
  Layers,
  ListChecks,
  Mail,
  Search,
  Send,
  ShieldAlert,
  Star,
  Trash2,
  type LucideIcon
} from 'lucide-react'
import type { AccountSummary, ConnectionState, FolderNode, SpecialUse } from '@peregrine/core/types'
import type { SavedSearch } from '@peregrine/core/savedSearches'
import ConnectionIndicator from '@renderer/components/ConnectionIndicator'
import {
  UNIFIED_SPECIAL_USES,
  viewKey,
  type MailboxView,
  type UnifiedSpecialUse
} from '@renderer/state/mailboxStore'
import { accountLabel, accountTitle, folderLabel } from '@renderer/util/folderLabel'

interface FolderTreeProps {
  accounts: AccountSummary[]
  folders: FolderNode[]
  savedSearches: SavedSearch[]
  /** Messages waiting to come back. Zero hides the entry. An empty list is not a place. */
  snoozedCount: number
  /** Open items on the daily list; shown as a count on the entry. */
  openTaskCount: number
  view: MailboxView | null
  connectionStates: Record<string, ConnectionState | undefined>
  /** When off, only the per-account trees are shown. */
  unifiedEnabled: boolean
  onSelect: (view: MailboxView) => void
  onFolderContextMenu: (folder: FolderNode, x: number, y: number) => void
  onSavedSearchContextMenu: (search: SavedSearch, x: number, y: number) => void
  onAccountContextMenu: (account: AccountSummary, x: number, y: number) => void
  /** Messages were dropped on a folder; the caller performs the move. */
  onDropMessages: (folder: FolderNode) => void
}

const specialUseIcon: Record<string, LucideIcon> = {
  inbox: Inbox,
  sent: Send,
  drafts: FileEdit,
  trash: Trash2,
  junk: ShieldAlert,
  archive: Archive
}

const EXPANDED_STORAGE_KEY = 'peregrine.folderTree.collapsed'

/**
 * What is collapsed on the very first start: the per account rows under the unified folders.
 *
 * Everything used to be open by default, which with twelve accounts means six unified folders
 * with twelve rows each, so **seventy two rows** before the first real account even appears.
 * The unified folders themselves stay visible, because they are the point of the view. Their
 * breakdown by account is a follow up question that is rarely asked.
 */
function defaultCollapsed(): Set<string> {
  return new Set(UNIFIED_SPECIAL_USES.map((specialUse) => `unified:${specialUse}:children`))
}

function loadCollapsed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(EXPANDED_STORAGE_KEY)
    // Only preset on the very first start. Anyone who has expanded these rows once should find
    // them expanded after a restart, including when nothing is collapsed and the stored list
    // therefore looks empty.
    if (raw === null) return defaultCollapsed()
    return new Set(JSON.parse(raw) as string[])
  } catch {
    return defaultCollapsed()
  }
}

function buildChildrenMap(folders: FolderNode[]): Map<string | null, FolderNode[]> {
  const map = new Map<string | null, FolderNode[]>()
  for (const folder of folders) {
    const siblings = map.get(folder.parentId) ?? []
    siblings.push(folder)
    map.set(folder.parentId, siblings)
  }
  // Special-use folders first (inbox, drafts, sent, …), everything else alphabetically,
  // the ordering every mail client uses.
  const rank = (folder: FolderNode): number => {
    const index = UNIFIED_SPECIAL_USES.indexOf(folder.specialUse as UnifiedSpecialUse)
    return index === -1 ? UNIFIED_SPECIAL_USES.length : index
  }
  for (const siblings of map.values()) {
    siblings.sort((a, b) => rank(a) - rank(b) || a.displayName.localeCompare(b.displayName))
  }
  return map
}

interface RowProps {
  label: string
  /** What appears on hover when the label does not say everything. */
  title?: string
  icon: LucideIcon
  depth: number
  selected: boolean
  unreadCount: number
  onClick: () => void
  expandable?: boolean
  expanded?: boolean
  onToggleExpand?: () => void
  colorDot?: string
  trailing?: JSX.Element
  onContextMenu?: (event: MouseEvent<HTMLElement>) => void
  /** Set on real folders only: unified nodes are not a place mail can be moved to. */
  onDrop?: () => void
}

function TreeRow({
  label,
  title,
  icon: Icon,
  depth,
  selected,
  unreadCount,
  onClick,
  expandable,
  expanded,
  onToggleExpand,
  colorDot,
  trailing,
  onContextMenu,
  onDrop
}: RowProps): JSX.Element {
  const { t } = useTranslation()
  const [dropActive, setDropActive] = useState(false)

  return (
    <div
      className={dropActive ? 'folder-row drop-target' : 'folder-row'}
      style={{ paddingLeft: `${depth * 0.85}rem` }}
      // The nesting is drawn with an indent, which a screen reader cannot see. The level and
      // the open state have to be said outright, or the tree reads as a flat list.
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={selected}
      aria-expanded={expandable ? expanded : undefined}
      // Without a label of its own the name is assembled from every child, which reads as
      // "expand Posteingang, Posteingang, 4". The count is the only thing worth adding.
      aria-label={unreadCount > 0 ? t('mailbox.folderUnread', { name: label, count: unreadCount }) : label}
      onContextMenu={onContextMenu}
      onDragOver={
        onDrop
          ? (event) => {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              setDropActive(true)
            }
          : undefined
      }
      onDragLeave={onDrop ? () => setDropActive(false) : undefined}
      onDrop={
        onDrop
          ? (event) => {
              event.preventDefault()
              setDropActive(false)
              onDrop()
            }
          : undefined
      }
    >
      <button
        className="folder-caret-button"
        aria-hidden={!expandable}
        tabIndex={expandable ? 0 : -1}
        aria-label={expanded ? t('mailbox.collapse', { name: label }) : t('mailbox.expand', { name: label })}
        onClick={(event) => {
          event.stopPropagation()
          onToggleExpand?.()
        }}
      >
        {expandable && (
          <ChevronRight
            size={12}
            strokeWidth={2}
            className={expanded ? 'chevron-toggle expanded' : 'chevron-toggle'}
          />
        )}
      </button>
      <button
        className={selected ? 'folder-item selected' : 'folder-item'}
        title={title}
        onClick={onClick}
      >
        {colorDot && <span className="account-color-dot" style={{ background: colorDot }} />}
        <Icon size={14} className="folder-icon" strokeWidth={1.75} />
        <span className="folder-label">{label}</span>
        {trailing}
        {unreadCount > 0 && <span className="folder-item-count">{unreadCount}</span>}
      </button>
    </div>
  )
}

function FolderTree({
  accounts,
  folders,
  savedSearches,
  snoozedCount,
  openTaskCount,
  view,
  connectionStates,
  unifiedEnabled,
  onSelect,
  onFolderContextMenu,
  onSavedSearchContextMenu,
  onAccountContextMenu,
  onDropMessages
}: FolderTreeProps): JSX.Element {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed)

  function toggle(key: string): void {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      window.localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify(Array.from(next)))
      return next
    })
  }

  const activeKey = viewKey(view)
  const accountOf = (accountId: string): AccountSummary | undefined =>
    accounts.find((a) => a.id === accountId)

  const treeRef = useRef<HTMLElement>(null)

  const visibleItems = (): HTMLElement[] =>
    Array.from(treeRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])

  /**
   * Keeps exactly one row reachable by Tab.
   *
   * A tree is one stop in the tab order, not one per folder: with twelve accounts the other
   * way round means eighty Tab presses to get past the sidebar. Which row that stop is has
   * to follow the selection, so tabbing in lands where the user last was rather than at the
   * top of the list.
   */
  useEffect(() => {
    const items = visibleItems()
    const current =
      items.find((item) => item.getAttribute('aria-selected') === 'true') ?? items[0]
    for (const item of items) item.tabIndex = item === current ? 0 : -1
  })

  /** The button that opens and closes a row, so the arrow keys can press it. */
  function caretOf(item: HTMLElement): HTMLElement | null {
    return item.querySelector<HTMLElement>('.folder-caret-button')
  }

  /**
   * What a tree is expected to answer to.
   *
   * Worked out from the DOM rather than from the model behind it. The sidebar is built by
   * four separate render paths, unified folders, saved searches, the standing entries and
   * the accounts, and each nests differently. What they agree on is the row markup, so that
   * is what this reads.
   */
  function handleTreeKey(event: ReactKeyboardEvent<HTMLElement>): void {
    const items = visibleItems()
    const current = items.findIndex((item) => item.contains(document.activeElement))
    if (current === -1) return

    const item = items[current]
    const expanded = item.getAttribute('aria-expanded')
    const move = (index: number): void => {
      event.preventDefault()
      items[Math.min(items.length - 1, Math.max(0, index))]?.focus()
    }

    switch (event.key) {
      case 'ArrowDown':
        return move(current + 1)
      case 'ArrowUp':
        return move(current - 1)
      case 'Home':
        return move(0)
      case 'End':
        return move(items.length - 1)
      case 'ArrowRight':
        // Closed: open it. Open: step into it, which is the row below by construction.
        if (expanded === 'false') {
          event.preventDefault()
          caretOf(item)?.click()
          return
        }
        if (expanded === 'true') return move(current + 1)
        return
      case 'ArrowLeft': {
        if (expanded === 'true') {
          event.preventDefault()
          caretOf(item)?.click()
          return
        }
        // Otherwise up to the parent, which is the nearest row above at a shallower level.
        const level = Number(item.getAttribute('aria-level') ?? '1')
        for (let i = current - 1; i >= 0; i -= 1) {
          if (Number(items[i].getAttribute('aria-level') ?? '1') < level) return move(i)
        }
        return
      }
      case 'Enter':
      case ' ':
        event.preventDefault()
        item.querySelector<HTMLElement>('.folder-item')?.click()
        return
    }
  }

  function renderBranch(
    childrenMap: Map<string | null, FolderNode[]>,
    parentId: string | null,
    depth: number
  ): JSX.Element[] {
    return (childrenMap.get(parentId) ?? []).flatMap((folder) => {
      const children = childrenMap.get(folder.id) ?? []
      const key = `folder:${folder.id}`
      const isCollapsed = collapsed.has(key)
      const Icon = specialUseIcon[folder.specialUse ?? ''] ?? Folder
      const rows = [
        <TreeRow
          key={key}
          label={folderLabel(folder, t)}
          icon={Icon}
          depth={depth}
          selected={activeKey === key}
          unreadCount={folder.unreadCount}
          expandable={children.length > 0}
          expanded={!isCollapsed}
          onToggleExpand={() => toggle(key)}
          onClick={() => onSelect({ kind: 'folder', folderId: folder.id })}
          onContextMenu={(event) => {
            event.preventDefault()
            onFolderContextMenu(folder, event.clientX, event.clientY)
          }}
          onDrop={() => onDropMessages(folder)}
        />
      ]
      if (children.length > 0 && !isCollapsed) {
        rows.push(...renderBranch(childrenMap, folder.id, depth + 1))
      }
      return rows
    })
  }

  if (folders.length === 0) {
    return <p className="folder-tree-empty">{t('mailbox.noFolders')}</p>
  }

  // A unified node only earns its place when more than one account contributes to it.
  const unifiedGroups = UNIFIED_SPECIAL_USES.map((specialUse) => ({
    specialUse,
    members: folders.filter((folder) => folder.specialUse === (specialUse as SpecialUse))
  })).filter((group) => group.members.length > 1)

  return (
    <nav
      className="folder-tree"
      role="tree"
      aria-label={t('mailbox.folderTreeLabel')}
      ref={treeRef}
      onKeyDown={handleTreeKey}
    >
      {unifiedEnabled && unifiedGroups.length > 0 && (
        <div className="folder-group" role="none">
          <TreeRow
            label={t('mailbox.unified')}
            icon={Layers}
            depth={0}
            selected={false}
            unreadCount={0}
            expandable
            expanded={!collapsed.has('unified')}
            onToggleExpand={() => toggle('unified')}
            onClick={() => toggle('unified')}
          />
          {!collapsed.has('unified') &&
            unifiedGroups.map((group) => {
              const key = `unified:${group.specialUse}`
              const unread = group.members.reduce((sum, folder) => sum + folder.unreadCount, 0)
              const isCollapsed = collapsed.has(`${key}:children`)
              return (
                <div key={key} role="none">
                  <TreeRow
                    label={t(`mailbox.specialUse.${group.specialUse}`)}
                    icon={specialUseIcon[group.specialUse] ?? Folder}
                    depth={1}
                    selected={activeKey === key}
                    unreadCount={unread}
                    expandable
                    expanded={!isCollapsed}
                    onToggleExpand={() => toggle(`${key}:children`)}
                    onClick={() => onSelect({ kind: 'unified', specialUse: group.specialUse })}
                  />
                  {!isCollapsed &&
                    group.members.map((folder) => {
                      // These rows say *which account* feeds the unified folder, so here the
                      // address is the actual statement rather than just a label.
                      const account = accountOf(folder.accountId)
                      return (
                        <TreeRow
                          key={folder.id}
                          label={account ? accountLabel(account) : folder.accountId}
                          title={account && accountTitle(account)}
                          icon={Mail}
                          depth={2}
                          selected={activeKey === `folder:${folder.id}`}
                          unreadCount={folder.unreadCount}
                          colorDot={account?.color}
                          onClick={() => onSelect({ kind: 'folder', folderId: folder.id })}
                          onContextMenu={(event) => {
                            event.preventDefault()
                            onFolderContextMenu(folder, event.clientX, event.clientY)
                          }}
                          onDrop={() => onDropMessages(folder)}
                        />
                      )
                    })}
                </div>
              )
            })}
        </div>
      )}

      {/* Always there, unlike the reminders: an empty day is a fact worth seeing, and it is
          also where one adds the first task. */}
      <div className="folder-group" role="none">
        <TreeRow
          label={t('daily.title')}
          icon={ListChecks}
          depth={0}
          selected={activeKey === 'daily'}
          unreadCount={openTaskCount}
          onClick={() => onSelect({ kind: 'daily' })}
        />
      </div>

      {snoozedCount > 0 && (
        <div className="folder-group" role="none">
          <TreeRow
            label={t('snooze.folder')}
            icon={Clock}
            depth={0}
            selected={activeKey === 'snoozed'}
            // The count is what makes the entry worth having: it says how much is coming
            // back, without opening it.
            unreadCount={snoozedCount}
            onClick={() => onSelect({ kind: 'snoozed' })}
          />
        </div>
      )}

      {savedSearches.length > 0 && (
        <div className="folder-group" role="none">
          <TreeRow
            label={t('savedSearch.group')}
            icon={Star}
            depth={0}
            selected={false}
            unreadCount={0}
            expandable
            expanded={!collapsed.has('savedSearches')}
            onToggleExpand={() => toggle('savedSearches')}
            onClick={() => toggle('savedSearches')}
          />
          {!collapsed.has('savedSearches') &&
            savedSearches.map((search) => (
              <TreeRow
                key={search.id}
                label={search.name}
                icon={Search}
                depth={1}
                selected={activeKey === `search:${search.id}`}
                unreadCount={0}
                colorDot={search.color}
                onClick={() => onSelect({ kind: 'search', searchId: search.id })}
                onContextMenu={(event) => {
                  event.preventDefault()
                  onSavedSearchContextMenu(search, event.clientX, event.clientY)
                }}
              />
            ))}
        </div>
      )}

      {accounts.map((account) => {
        const accountFolders = folders.filter((folder) => folder.accountId === account.id)
        // An account without folders used to be left out entirely. Twelve set up, eleven in
        // the sidebar, no explanation. An account that is configured but appears nowhere looks
        // like a lost one. It is shown now and says that nothing has been fetched yet.
        const empty = accountFolders.length === 0
        const key = `account:${account.id}`
        const isCollapsed = collapsed.has(key)
        const unread = accountFolders
          .filter((folder) => folder.specialUse === 'inbox')
          .reduce((sum, folder) => sum + folder.unreadCount, 0)
        return (
          <div className="folder-group" role="none" key={account.id}>
            <div
              className="folder-row account-row"
              role="treeitem"
              aria-level={1}
              aria-expanded={empty ? undefined : !isCollapsed}
              aria-label={[
                accountLabel(account),
                t(`settings.connectionState.${connectionStates[account.id] ?? 'connecting'}`),
                unread > 0 ? t('mailbox.unreadCount', { count: unread }) : ''
              ]
                .filter((part) => part)
                .join(', ')}
              onContextMenu={(event) => {
                event.preventDefault()
                onAccountContextMenu(account, event.clientX, event.clientY)
              }}
            >
              <button
                className="folder-caret-button"
                aria-hidden={empty}
                tabIndex={empty ? -1 : 0}
                aria-label={
                  isCollapsed
                    ? t('mailbox.expand', { name: accountLabel(account) })
                    : t('mailbox.collapse', { name: accountLabel(account) })
                }
                onClick={() => toggle(key)}
              >
                {!empty && (
                  <ChevronRight
                    size={12}
                    strokeWidth={2}
                    className={isCollapsed ? 'chevron-toggle' : 'chevron-toggle expanded'}
                  />
                )}
              </button>
              <button
                className="folder-item account-item"
                title={accountTitle(account)}
                onClick={() => toggle(key)}
              >
                <span className="account-color-dot" style={{ background: account.color }} />
                <span className="folder-label">{accountLabel(account)}</span>
                <ConnectionIndicator state={connectionStates[account.id]} />
                {unread > 0 && <span className="folder-item-count">{unread}</span>}
              </button>
            </div>
            {empty && <p className="folder-account-empty">{t('mailbox.noFoldersYet')}</p>}
            {!empty && !isCollapsed && renderBranch(buildChildrenMap(accountFolders), null, 1)}
          </div>
        )
      })}
    </nav>
  )
}

export default FolderTree
