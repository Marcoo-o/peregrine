import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { List, useListRef, type RowComponentProps } from 'react-window'
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Clock,
  FolderInput,
  Paperclip,
  Star
} from 'lucide-react'
import type { AccountSummary, Density, MessageSummary } from '@peregrine/core/types'
import {
  COLUMN_MAX_WIDTH,
  COLUMN_MIN_WIDTH,
  MESSAGE_COLUMNS,
  parseColumns,
  parseColumnWidths,
  widthOf,
  type MessageColumnId
} from '@peregrine/core/messageColumns'
import { useMailboxStore } from '@renderer/state/mailboxStore'
import { useSettingsStore } from '@renderer/state/settingsStore'
import { useElementSize } from '@renderer/hooks/useElementSize'
import { formatBytes, formatListDate } from '@renderer/util/format'
import { threadRows } from '@renderer/util/threading'
import { folderLabel } from '@renderer/util/folderLabel'
import { useTagsStore } from '@renderer/state/tagsStore'

interface MessageListProps {
  messages: MessageSummary[]
  accounts: AccountSummary[]
  /** True while a unified view mixes several accounts, which then get a colour stripe. */
  showAccountColors: boolean
  onOpen: (message: MessageSummary) => void
  onEndReached: () => void
  onToggleFlag: (message: MessageSummary) => void
  onDeleteRow: (message: MessageSummary) => void
  onContextMenu: (message: MessageSummary, x: number, y: number) => void
  /** Called when rows are dropped onto a folder in the sidebar. */
  onDragMessages: (ids: string[]) => void
}

// react-window needs concrete pixel heights, so the density tokens are mirrored here rather
// than read back from CSS.
//
// One value per density now. The preview used to sit as a second line under the subject and
// grew the row from 34 to 56 pixels. It now stands behind the subject on the same line, so it
// costs no height at all and the two line case is gone.
const ROW_HEIGHTS: Record<Density, number> = {
  comfortable: 34,
  cozy: 30,
  compact: 26
}

/**
 * Row height for the subject only view.
 *
 * Without sender, date and size a row is one line of text, and that needs barely more height
 * than its own type. Still graded by density, because someone who sets the list roomy wants it
 * roomy here too. At the base font size 22 pixels is the line height plus three pixels of
 * padding on each side. Below that the letters of two rows start to touch.
 */
const SUBJECT_ONLY_HEIGHTS: Record<Density, number> = {
  comfortable: 26,
  cozy: 24,
  compact: 22
}


/** Weekday and time. The two things one wants from a reminder, in the width of a badge. */
function formatSnooze(until: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(until))
}

function participantsOf(message: MessageSummary, ownAddresses: Set<string>): string {
  const from = message.fromName || message.fromAddress
  // Sent and drafts folders are about who the mail went to, not who it came from.
  if (ownAddresses.has(message.fromAddress.toLowerCase()) && message.to.length > 0) {
    return `→ ${message.to.map((a) => a.name || a.address).join(', ')}`
  }
  return from
}

function MessageList({
  messages,
  accounts,
  showAccountColors,
  onOpen,
  onEndReached,
  onToggleFlag,
  onDeleteRow,
  onContextMenu,
  onDragMessages
}: MessageListProps): JSX.Element {
  const { t, i18n } = useTranslation()
  const settings = useSettingsStore((s) => s.settings)
  const setLocalSettings = useSettingsStore((s) => s.setLocal)
  const updateSettings = useSettingsStore((s) => s.update)
  const { density, showPreviewText, subjectOnly, threadView } = settings
  const { sort, toggleSort, selectedIds, activeId, setSelection, folders } = useMailboxStore()
  const [containerRef, { height }] = useElementSize<HTMLDivElement>()
  const listRef = useListRef(null)
  const notifiedForLength = useRef<number>(-1)
  const lastClickedIndex = useRef<number>(0)
  const [collapsedThreads, setCollapsedThreads] = useState<Set<string>>(new Set())

  // The preview no longer takes part here. It sits on the same line and costs no height.
  const rowHeight = subjectOnly ? SUBJECT_ONLY_HEIGHTS[density] : ROW_HEIGHTS[density]
  const ownAddresses = new Set(accounts.map((account) => account.emailAddress.toLowerCase()))
  const accountColors = new Map(accounts.map((account) => [account.id, account.color]))
  const accountNames = new Map(
    accounts.map((a) => [a.id, a.displayName || a.emailAddress])
  )
  const folderNames = new Map(folders.map((f) => [f.id, folderLabel(f, t)]))
  const tagsByKeyword = useTagsStore((s) => s.byKeyword)()
  const selected = new Set(selectedIds)

  // In thread view the visible rows are conversations, so every index below refers to this
  // list rather than to `messages` directly.
  const rows = useMemo(
    () =>
      threadView
        ? threadRows(messages, collapsedThreads)
        : messages.map((message) => ({ message, depth: 0, threadId: message.id, threadSize: 1 })),
    [messages, threadView, collapsedThreads]
  )

  /**
   * What a screen reader reads out for one row.
   *
   * The cells alone would be read as a run of unlabelled fragments, and the two things that
   * decide whether a message is worth opening, whether it is unread and whether it carries
   * an attachment, are shown as a dot and an icon and so are read as nothing at all.
   */
  function rowLabel(row: (typeof rows)[number]): string {
    const { message } = row
    const parts = [
      message.isRead ? '' : t('mailbox.unread'),
      message.fromName || message.fromAddress,
      message.subject || t('mailbox.noSubject'),
      message.hasAttachments ? t('mailbox.hasAttachment') : '',
      message.isFlagged ? t('mailbox.flagged') : '',
      row.threadSize > 1 ? t('mailbox.threadSize', { count: row.threadSize }) : ''
    ]
    return parts.filter((part) => part).join(', ')
  }

  const visibleColumns = useMemo(
    // The chosen columns stay stored, so switching back brings them straight back.
    () => (subjectOnly ? ['subject' as const] : parseColumns(settings.messageColumns)),
    [settings.messageColumns, subjectOnly]
  )
  const columnWidths = useMemo(() => parseColumnWidths(settings.columnWidths), [settings.columnWidths])

  /**
   * Column template shared by the header and every row.
   *
   * Built here rather than in CSS because both the set of columns and their widths are the
   * user's choice. The subject gets `1fr` with a floor, so widening another column eats into
   * the subject instead of pushing the table wider than its container.
   */
  const gridTemplate = [
    'var(--account-column)',
    '22px',
    '20px',
    // minmax rather than a bare width: a fixed track cannot shrink, so on a narrow window the
    // row would grow past its container and the last columns would be cut off instead of the
    // table simply getting tighter. The floor is per column and not zero. A track squeezed
    // to nothing does not shrink its text, it lets it run over the column beside it.
    ...visibleColumns.map((id) => {
      const column = MESSAGE_COLUMNS[id]
      const width = widthOf(id, columnWidths)
      return column.flexible
        ? `minmax(${column.minWidth}px, 1fr)`
        : `minmax(${Math.min(column.minWidth, width)}px, ${width}px)`
    }),
    '22px'
  ].join(' ')

  /**
   * Dragging the boundary between two columns.
   *
   * The boundary moves **both** neighbours in opposite directions. What the left one gives up,
   * the right one takes, and the other way round. That is the only way to satisfy two things at
   * once that both feel self evident and that otherwise contradict each other under a flexible
   * column. The line follows the pointer, and dragging left makes the column left of it
   * narrower.
   *
   * Why they otherwise contradict each other: the subject column is `1fr` and absorbs every
   * change. Change only the left column and the subject compensates, so the boundary stays put.
   * Change only the right one and the boundary moves, but the wrong column shrinks. Moving both
   * in opposite directions keeps the sum of the fixed columns the same, the subject does not
   * budge, and the boundary shifts by exactly the distance the pointer travelled.
   *
   * When the left neighbour is the flexible column there is nothing to set there. Only the
   * right one moves, the subject compensates on its own, and the boundary follows all the same.
   *
   * The width is written to local state while dragging and only persisted on release. Otherwise
   * every pixel of movement would be a database write.
   */
  function startColumnResize(
    left: MessageColumnId | null,
    right: MessageColumnId,
    event: React.PointerEvent
  ): void {
    event.preventDefault()
    const startX = event.clientX
    const startLeft = left ? widthOf(left, columnWidths) : 0
    const startRight = widthOf(right, columnWidths)
    const handle = event.currentTarget as HTMLElement
    handle.setPointerCapture(event.pointerId)

    /**
     * How far both sides can travel together.
     *
     * Without this shared limit one column would hit its bound while the other kept growing.
     * The sum would no longer add up, the subject would jump, and the line would run away from
     * the pointer. So the travel itself is clamped rather than each width on its own.
     */
    const clamp = (raw: number): number => {
      const range = (start: number, min: number, max: number): [number, number] => [
        min - start,
        max - start
      ]
      const [minR, maxR] = range(startRight, COLUMN_MIN_WIDTH, COLUMN_MAX_WIDTH)
      // The right column moves the other way, so its bounds are mirrored.
      let lower = -maxR
      let upper = -minR
      if (left) {
        const [minL, maxL] = range(startLeft, COLUMN_MIN_WIDTH, COLUMN_MAX_WIDTH)
        lower = Math.max(lower, minL)
        upper = Math.min(upper, maxL)
      }
      return Math.min(upper, Math.max(lower, raw))
    }

    let widths: Record<string, number> = columnWidths
    const onMove = (move: PointerEvent): void => {
      const delta = clamp(move.clientX - startX)
      widths = { ...columnWidths, [right]: startRight - delta }
      if (left) widths[left] = startLeft + delta
      setLocalSettings({ columnWidths: JSON.stringify(widths) })
    }
    const onUp = (): void => {
      handle.releasePointerCapture(event.pointerId)
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      void updateSettings({ columnWidths: JSON.stringify(widths) })
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
  }

  function toggleThread(threadId: string): void {
    setCollapsedThreads((prev) => {
      const next = new Set(prev)
      if (next.has(threadId)) next.delete(threadId)
      else next.add(threadId)
      return next
    })
  }

  // Keep the keyboard-driven active row in view as the user walks the list.
  useEffect(() => {
    if (!activeId) return
    const index = rows.findIndex((row) => row.message.id === activeId)
    if (index >= 0) listRef.current?.scrollToRow({ index, align: 'smart' })
  }, [activeId, rows])

  function handleRowsRendered(visibleRows: { startIndex: number; stopIndex: number }): void {
    const nearEnd = visibleRows.stopIndex >= rows.length - 8
    if (nearEnd && notifiedForLength.current !== messages.length) {
      notifiedForLength.current = messages.length
      onEndReached()
    }
  }

  function handleRowClick(index: number, event: MouseEvent): void {
    const message = rows[index].message
    if (event.shiftKey) {
      const [from, to] = [lastClickedIndex.current, index].sort((a, b) => a - b)
      setSelection(
        rows.slice(from, to + 1).map((row) => row.message.id),
        message.id
      )
      return
    }
    if (event.ctrlKey || event.metaKey) {
      const next = selected.has(message.id)
        ? selectedIds.filter((id) => id !== message.id)
        : [...selectedIds, message.id]
      lastClickedIndex.current = index
      setSelection(next, message.id)
      return
    }
    lastClickedIndex.current = index
    setSelection([message.id], message.id)
    onOpen(message)
  }

  if (messages.length === 0) {
    return <p className="message-list-empty">{t('mailbox.noMessages')}</p>
  }

  function Row({ ariaAttributes, index, style }: RowComponentProps): JSX.Element {
    const row = rows[index]
    const message = row.message
    const classNames = ['message-row']
    if (selected.has(message.id)) classNames.push('selected')
    if (message.id === activeId) classNames.push('active')
    if (!message.isRead) classNames.push('unread')

    return (
      <div
        style={style}
        className={classNames.join(' ')}
        // Only the visible rows exist in the DOM, so the count and the position have to be
        // stated; react-window works those out and hands them over. Its role is replaced:
        // these rows are selectable, and a plain list item cannot say that it is selected.
        {...ariaAttributes}
        role="option"
        // Referenced by aria-activedescendant on the list, which is how a screen reader is
        // told which row is current without the focus ever leaving the list itself.
        id={`message-row-${message.id}`}
        aria-selected={selected.has(message.id)}
        aria-label={rowLabel(row)}
        draggable
        onDragStart={(event) => {
          // Dragging an unselected row acts on that row, not on the stale selection.
          const ids = selected.has(message.id) ? selectedIds : [message.id]
          if (!selected.has(message.id)) setSelection(ids, message.id)
          onDragMessages(ids)
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', ids.join(','))
        }}
        onClick={(event) => handleRowClick(index, event)}
        onDoubleClick={() => onOpen(message)}
        onContextMenu={(event) => {
          event.preventDefault()
          if (!selected.has(message.id)) setSelection([message.id], message.id)
          onContextMenu(message, event.clientX, event.clientY)
        }}
      >
        {/* Always rendered, even at zero width: the header carries the same placeholder, and
            dropping it here would shift every following cell out of its column. */}
        <span
          className="message-row-account"
          style={{
            background: showAccountColors
              ? (accountColors.get(message.accountId) ?? 'transparent')
              : 'transparent'
          }}
        />
        <button
          className={message.isFlagged ? 'flag-button flagged' : 'flag-button'}
          aria-label={t('mailbox.toggleFlag')}
          title={t('mailbox.toggleFlag')}
          onClick={(event) => {
            event.stopPropagation()
            onToggleFlag(message)
          }}
        >
          <Star size={13} strokeWidth={1.75} fill={message.isFlagged ? 'currentColor' : 'none'} />
        </button>
        <span className="message-row-attachment">
          {message.hasAttachments && <Paperclip size={12} strokeWidth={1.75} />}
        </span>
        {/* Cells follow the configured column order, so header and row can never drift. */}
        {visibleColumns.map((id) => {
          switch (id) {
            case 'subject':
              return (
                <div
                  key={id}
                  className="message-row-main"
                  style={{ paddingLeft: `${row.depth * 0.9}rem` }}
                >
                  <span className="message-row-subject">
                    {/* Still listed here because it is still here: the move was decided
                        without a connection and has not reached the server yet. Saying where
                        it is headed beats letting it vanish into no folder at all. */}
                    {message.pendingMoveTo !== null && (
                      <span
                        className="message-row-pending-move"
                        title={t('mailbox.pendingMoveTo', {
                          folder: folderNames.get(message.pendingMoveTo) ?? ''
                        })}
                      >
                        <FolderInput size={10} strokeWidth={2} />
                        {folderNames.get(message.pendingMoveTo) ?? ''}
                      </span>
                    )}
                    {/* A message put aside is only visible in the reminder list and in a
                        search, and in both the time is the reason it is there. */}
                    {message.snoozedUntil !== null && (
                      <span
                        className="message-row-snooze"
                        title={t('snooze.until', { when: formatSnooze(message.snoozedUntil) })}
                      >
                        <Clock size={10} strokeWidth={2} />
                        {formatSnooze(message.snoozedUntil)}
                      </span>
                    )}
                    {/* Dots rather than chips: in a dense list the colour is what carries the
                        information, and full labels would crowd out the subject itself. */}
                    {message.tagKeywords.map((keyword) => {
                      const tag = tagsByKeyword.get(keyword)
                      if (!tag) return null
                      return (
                        <span
                          key={keyword}
                          className="message-row-tag"
                          style={{ background: tag.color }}
                          title={tag.name}
                        />
                      )
                    })}
                    {row.threadSize > 1 && (
                      <button
                        className="thread-toggle"
                        title={t('mailbox.toggleThread')}
                        onClick={(event) => {
                          event.stopPropagation()
                          toggleThread(row.threadId)
                        }}
                      >
                        <ChevronRight
                          size={12}
                          strokeWidth={2}
                          className={
                            collapsedThreads.has(row.threadId) ? 'chevron-toggle' : 'chevron-toggle expanded'
                          }
                        />
                        {row.threadSize}
                      </button>
                    )}
                    {message.subject || t('mailbox.noSubject')}
                  </span>
                  {showPreviewText && message.previewText && (
                    <span className="message-row-preview">{message.previewText}</span>
                  )}
                </div>
              )
            case 'participants':
              return (
                <span key={id} className="message-row-participants">
                  {participantsOf(message, ownAddresses)}
                </span>
              )
            case 'date':
              return (
                <span key={id} className="message-row-date">
                  {formatListDate(message.date, i18n.language, settings.dateFormat)}
                </span>
              )
            case 'size':
              return (
                <span key={id} className="message-row-size">
                  {formatBytes(message.sizeBytes, i18n.language)}
                </span>
              )
            case 'account':
              return (
                <span key={id} className="message-row-meta">
                  {accountNames.get(message.accountId) ?? ''}
                </span>
              )
            case 'folder':
              return (
                <span key={id} className="message-row-meta">
                  {folderNames.get(message.folderId) ?? ''}
                </span>
              )
          }
        })}
        <button
          className="row-delete-button"
          aria-label={t('mailbox.delete')}
          title={t('mailbox.delete')}
          onClick={(event) => {
            event.stopPropagation()
            onDeleteRow(message)
          }}
        >
          ×
        </button>
      </div>
    )
  }

  return (
    <div
      className="message-table"
      data-account-colors={showAccountColors ? 'on' : 'off'}
      style={{ ['--message-columns' as string]: gridTemplate }}
    >
      <div className="message-table-header">
        <span className="message-header-account" />
        <span className="message-header-flag">
          <Star size={12} strokeWidth={1.75} />
        </span>
        <span className="message-header-attachment">
          <Paperclip size={12} strokeWidth={1.75} />
        </span>
        {visibleColumns.map((id, index) => {
          const spec = MESSAGE_COLUMNS[id]
          const label = t(`mailbox.columns.${id}`)
          const active = spec.sortField != null && sort.field === spec.sortField
          /**
           * The grip sits on the boundary to the column before it and moves both.
           *
           * That is why it belongs to the *right* of the two columns, because there the boundary
           * lies on that column's left edge. The first column has no neighbour to its left and
           * gets no grip.
           *
           * A flexible left neighbour has no width to set, so only the right one changes and the
           * subject column compensates on its own.
           */
          const previous = visibleColumns[index - 1]
          const grip =
            index === 0
              ? null
              : { left: previous && MESSAGE_COLUMNS[previous].flexible ? null : previous, right: id }
          return (
            <button
              key={id}
              className={active ? 'column-header active' : 'column-header'}
              onClick={() => spec.sortField && toggleSort(spec.sortField)}
            >
              {/* Eigenes Element, damit das Abschneiden hier sitzt und nicht am Knopf: Der
                  Knopf muss den Griff über seinen Rand hinausragen lassen, ein `overflow:
                  hidden` dort würde ihn abschneiden. */}
              <span className="column-label">{label}</span>
              {active &&
                (sort.direction === 'asc' ? (
                  <ArrowUp size={11} strokeWidth={2} />
                ) : (
                  <ArrowDown size={11} strokeWidth={2} />
                ))}
              {grip && (
                // Inside the button, but swallowing the click: dragging the edge must not
                // also re-sort the table.
                <span
                  className="column-resizer"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={t('mailbox.resizeColumn', {
                    column: t(`mailbox.columns.${grip.right}`)
                  })}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    startColumnResize(grip.left ?? null, grip.right, e)
                  }}
                />
              )}
            </button>
          )
        })}
        <span className="message-header-actions" />
      </div>
      <div className="message-table-body" ref={containerRef}>
        {height > 0 && (
          <List
            listRef={listRef}
            role="listbox"
            aria-multiselectable
            aria-label={t('mailbox.messageListLabel')}
            // The list takes the focus itself and points at the current row rather than
            // moving the focus onto it: the rows are recycled while scrolling, so a focused
            // row would lose the focus the moment it is reused for a different message.
            tabIndex={0}
            aria-activedescendant={activeId ? `message-row-${activeId}` : undefined}
            // The class lands on the scrolling element itself. Only there does the reserved
            // strip take effect. On the container around it, it does nothing.
            className="message-scroll"
            style={{ height, width: '100%' }}
            rowCount={rows.length}
            rowHeight={rowHeight}
            rowComponent={Row}
            rowProps={{}}
            overscanCount={8}
            onRowsRendered={handleRowsRendered}
          />
        )}
      </div>
    </div>
  )
}

export default MessageList
