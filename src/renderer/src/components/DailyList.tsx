import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { CalendarArrowDown, GripVertical, Mail, Plus, Repeat, Trash2, X } from 'lucide-react'
import type { DailyMail, DailyTask } from '@peregrine/core/types'
import { parseRecurrence, serializeRecurrence, type Recurrence } from '@peregrine/core/recurrence'
import { useTasksStore } from '@renderer/state/tasksStore'
import { toastInfo } from '@renderer/state/toastStore'

interface DailyListProps {
  /** Opens the message a task or a tagged mail points at. */
  onOpenMail: (mail: { accountId: string; folderId: string; uid: number }) => void
}

/** The rules offered in the menu; anything else can be stored but is not built here. */
const RECURRENCES: Recurrence[] = [
  { kind: 'once' },
  { kind: 'daily' },
  { kind: 'weekdays' },
  { kind: 'weekly', weekday: 1 },
  { kind: 'monthly', day: 1 }
]

function recurrenceLabel(rule: Recurrence, t: TFunction): string {
  switch (rule.kind) {
    case 'once':
      return t('daily.recurrence.once')
    case 'daily':
      return t('daily.recurrence.daily')
    case 'weekdays':
      return t('daily.recurrence.weekdays')
    case 'weekly':
      return t('daily.recurrence.weekly', {
        day: new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(
          // 4 January 1970 was a Sunday, so this lands on the right weekday name.
          new Date(Date.UTC(1970, 0, 4 + rule.weekday))
        )
      })
    case 'monthly':
      return t('daily.recurrence.monthly', { day: rule.day })
  }
}

function TaskRow({
  task,
  index,
  onOpenMail,
  onDragStart,
  onDropOn
}: {
  task: DailyTask
  index: number
  onOpenMail: DailyListProps['onOpenMail']
  onDragStart: (index: number) => void
  onDropOn: (index: number) => void
}): JSX.Element {
  const { t } = useTranslation()
  const { setDone, setItemDone, addItem, deleteItem, remove, update, defer } = useTasksStore()
  const [dropTarget, setDropTarget] = useState(false)
  const [newItem, setNewItem] = useState('')
  // Held locally while typing and written on leaving the field, so every keystroke is not a
  // database write and a reload of the whole list.
  const [notes, setNotes] = useState(task.notes)
  const rule = parseRecurrence(task.recurrence)

  return (
    <li
      className={`daily-task${task.done ? ' done' : ''}${dropTarget ? ' drop-target' : ''}`}
      onDragOver={(event) => {
        event.preventDefault()
        setDropTarget(true)
      }}
      onDragLeave={() => setDropTarget(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDropTarget(false)
        onDropOn(index)
      }}
    >
      <div className="daily-task-head">
        {/* Only the handle starts a drag. Making the whole row draggable would fight with
            selecting text in the title and the notes below it. */}
        <span
          className="daily-grip"
          draggable
          onDragStart={() => onDragStart(index)}
          aria-hidden="true"
        >
          <GripVertical size={13} strokeWidth={1.75} />
        </span>
        <label className="daily-check">
          <input
            type="checkbox"
            checked={task.done}
            onChange={(e) => void setDone(task.id, e.target.checked)}
          />
          <span className="daily-task-title">{task.title}</span>
        </label>

        {task.link && (
          <button
            className="daily-link"
            title={t('daily.openMail')}
            // Asked for freshly rather than taken from the stored link: the folder and uid
            // stop being true the moment the message is moved, and the Message-ID stored
            // beside them is what finds it again.
            onClick={() => {
              void window.peregrine.tasks.resolveMessage(task.id).then((ref) => {
                if (ref) onOpenMail(ref)
                else toastInfo(t('daily.mailGone'))
              })
            }}
          >
            <Mail size={13} strokeWidth={1.75} />
          </button>
        )}

        <select
          className="daily-recurrence"
          value={serializeRecurrence(rule)}
          onChange={(e) => void update(task.id, { recurrence: e.target.value })}
          title={t('daily.recurrenceTitle')}
        >
          {RECURRENCES.map((option) => (
            <option key={serializeRecurrence(option)} value={serializeRecurrence(option)}>
              {recurrenceLabel(option, t)}
            </option>
          ))}
        </select>

        {/* Only for one-off tasks. For a recurring one the rule decides when it returns, and
            a button that silently shifted every future occurrence would be a trap. */}
        {rule.kind === 'once' && !task.done && (
          <button
            className="daily-defer"
            onClick={() => {
              void defer(task.id).then(({ moved }) => {
                if (moved) toastInfo(t('daily.deferred'))
              })
            }}
            aria-label={t('daily.deferTomorrow')}
            title={t('daily.deferTomorrow')}
          >
            <CalendarArrowDown size={13} strokeWidth={1.75} />
          </button>
        )}

        <button
          className="daily-remove"
          onClick={() => void remove(task.id)}
          aria-label={t('daily.deleteTask')}
          title={t('daily.deleteTask')}
        >
          <Trash2 size={13} strokeWidth={1.75} />
        </button>
      </div>

      {/* Stored since the table existed, but until now there was no way to put anything in
          it. A note belongs to a task the same way a subject belongs to a mail: one line,
          edited where it is read, saved on leaving rather than behind a button. */}
      <textarea
        className="daily-notes"
        value={notes}
        placeholder={t('daily.notesPlaceholder')}
        rows={notes.split('\n').length}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => {
          if (notes !== task.notes) void update(task.id, { notes })
        }}
      />

      <ul className="daily-items">
        {task.items.map((item) => (
          <li key={item.id}>
            <label className="daily-check">
              <input
                type="checkbox"
                // Ticked yesterday is open again today. The stored day decides, not a flag.
                checked={item.doneOn === useTasksStore.getState().list.dayKey}
                onChange={(e) => void setItemDone(item.id, e.target.checked)}
              />
              <span>{item.title}</span>
            </label>
            <button
              className="daily-remove"
              onClick={() => void deleteItem(item.id)}
              aria-label={t('daily.deleteItem')}
            >
              <X size={11} strokeWidth={2} />
            </button>
          </li>
        ))}
        <li className="daily-add-item">
          <input
            value={newItem}
            placeholder={t('daily.addItem')}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || !newItem.trim()) return
              e.preventDefault()
              void addItem(task.id, newItem)
              setNewItem('')
            }}
          />
        </li>
      </ul>
    </li>
  )
}

function MailRow({
  mail,
  onOpenMail
}: {
  mail: DailyMail
  onOpenMail: DailyListProps['onOpenMail']
}): JSX.Element {
  // A button rather than a clickable `li`. As a list item the row could be opened with the
  // mouse and not at all with the keyboard. It never appeared in the tab order, carried no
  // role, and Enter did nothing. Anything a click triggers has to be reachable without a mouse.
  return (
    <li>
      <button type="button" className="daily-mail" onClick={() => onOpenMail(mail)}>
        <Mail size={13} strokeWidth={1.75} />
        <span className="daily-mail-subject">{mail.subject}</span>
        <span className="daily-mail-from">{mail.fromName || mail.fromAddress}</span>
      </button>
    </li>
  )
}

/**
 * What is on today's list.
 *
 * Two kinds of entry, deliberately kept apart. A task is something written down here; a mail
 * is on the list because it carries the configured keyword, and it leaves the list by losing
 * that keyword. Not by being ticked here. Mixing the two would mean a tick that sometimes
 * changes the server and sometimes does not.
 */
function DailyList({ onOpenMail }: DailyListProps): JSX.Element {
  const { t } = useTranslation()
  const { list, loaded, load, create, reorder } = useTasksStore()
  /** Which row the drag started on; a ref, so moving the pointer does not re-render. */
  const dragFrom = useRef<number | null>(null)
  const [title, setTitle] = useState('')

  useEffect(() => {
    void load()
  }, [])

  const open = list.tasks.filter((task) => !task.done).length

  return (
    <section className="daily-list">
      <header className="daily-header">
        <h1>{t('daily.title')}</h1>
        <span className="daily-count">{t('daily.openCount', { count: open })}</span>
        <span className="daily-date">
          {list.dayKey &&
            new Intl.DateTimeFormat(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long'
            }).format(new Date(`${list.dayKey}T12:00:00`))}
        </span>
      </header>

      <div className="daily-new">
        <Plus size={14} strokeWidth={1.75} />
        <input
          value={title}
          placeholder={t('daily.newTask')}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || !title.trim()) return
            e.preventDefault()
            void create({ title })
            setTitle('')
          }}
        />
      </div>

      {loaded && list.tasks.length === 0 && list.mails.length === 0 && (
        <p className="daily-empty">{t('daily.empty')}</p>
      )}

      <ul className="daily-tasks">
        {list.tasks.map((task, index) => (
          <TaskRow
            key={task.id}
            task={task}
            index={index}
            onOpenMail={onOpenMail}
            onDragStart={(from) => (dragFrom.current = from)}
            onDropOn={(to) => {
              const from = dragFrom.current
              dragFrom.current = null
              if (from !== null && from !== to) void reorder(list.tasks[from].id, to)
            }}
          />
        ))}
      </ul>

      {list.mails.length > 0 && (
        <>
          <h2 className="daily-subheading">
            <Repeat size={12} strokeWidth={1.75} />
            {t('daily.fromMail')}
          </h2>
          <p className="daily-hint">{t('daily.fromMailHint')}</p>
          <ul className="daily-mails">
            {list.mails.map((mail) => (
              <MailRow key={`${mail.folderId}-${mail.uid}`} mail={mail} onOpenMail={onOpenMail} />
            ))}
          </ul>
        </>
      )}

    </section>
  )
}

export default DailyList
