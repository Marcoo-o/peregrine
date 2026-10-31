import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import type { Recurrence } from '@peregrine/core/recurrence'
import { parseRecurrence } from '@peregrine/core/recurrence'
import type { TasksState } from '../app/screens'
import { REPEATS, today, type DayTask } from '../tasks'
import { t, language } from '../i18n'
import { ActionSheet, type SheetAction } from './ActionSheet'
import { Dropdown } from './Dropdown'
import { FormInput, FormScroll } from './FormScroll'
import { Header } from './Header'
import { Icon } from './Icon'
import { useStyles } from './useStyles'
import { useTheme } from './useTheme'

/** How a rule reads under the title, nothing for a task that happens once. */
function repeatText(recurrence: string): string {
  const kind = parseRecurrence(recurrence).kind
  const found = REPEATS.find((repeat) => repeat.kind === kind)
  return found && kind !== 'once' ? t(found.label) : ''
}

function dayText(day: string): string {
  if (day === today()) return t('Heute')
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date).toLocaleDateString(language.locale, { weekday: 'long', day: 'numeric', month: 'long' })
}

/** The round mark to tick a task or a point of its checklist. */
function Tick(props: { on: boolean; label: string; size?: number; onPress: () => void }) {
  const styles = useStyles()
  const { colors } = useTheme()
  const size = props.size ?? 26
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: props.on }} accessibilityLabel={props.label} hitSlop={10} style={[styles.tick, { width: size, height: size, borderRadius: size / 2 }, props.on && styles.tickOn]} onPress={props.onPress}>
      {props.on ? <Icon name="check" size={size - 10} color={colors.onAccent} /> : null}
    </Pressable>
  )
}

/** The daily list: what is due today as rows to tick, a quick entry to add one, and a menu for the rest of what is done to a task. */
export function TasksScreen(props: {
  state: TasksState
  onBack: () => void
  onAdd: (title: string, repeat: Recurrence['kind']) => void
  onDone: (id: string, done: boolean) => void
  onItem: (itemId: string, done: boolean) => void
  onAddItem: (taskId: string, title: string) => void
  onRemoveItem: (itemId: string) => void
  onDefer: (id: string) => void
  onRemove: (id: string) => void
  onOpenMessage: (task: DayTask) => void
}) {
  const styles = useStyles()
  const { day, tasks, notice, error } = props.state
  const [title, setTitle] = useState('')
  const [repeat, setRepeat] = useState<Recurrence['kind']>('once')
  const [menuFor, setMenuFor] = useState<DayTask | null>(null)
  const [pointFor, setPointFor] = useState<string | null>(null)
  const [point, setPoint] = useState('')
  const open = tasks.filter((task) => !task.done).length

  const add = () => {
    if (title.trim() === '') return
    props.onAdd(title, repeat)
    setTitle('')
    setRepeat('once')
  }
  const addPoint = () => {
    if (pointFor && point.trim() !== '') props.onAddItem(pointFor, point)
    setPoint('')
    setPointFor(null)
  }
  const actionsFor = (task: DayTask): SheetAction[] => [
    ...(task.link ? [{ label: t('Nachricht öffnen'), onPress: () => props.onOpenMessage(task) }] : []),
    { label: t('Punkt zur Checkliste'), onPress: () => setPointFor(task.id) },
    ...(parseRecurrence(task.recurrence).kind === 'once' ? [{ label: t('Auf morgen'), onPress: () => props.onDefer(task.id) }] : []),
    { label: t('Entfernen'), danger: true, onPress: () => props.onRemove(task.id) }
  ]

  return (
    <FormScroll>
      <Header title={t('Aufgaben')} back={{ label: t('Konten'), onPress: props.onBack }} />
      <Text style={styles.hint}>{tasks.length === 0 ? dayText(day) : `${dayText(day)}, ${t('{count} offen', { count: open })}`}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.hint}>{notice}</Text> : null}

      <View style={styles.fieldRow}>
        <View style={{ flex: 1 }}>
          <FormInput placeholder={t('Neue Aufgabe')} value={title} onChangeText={setTitle} onSubmitEditing={add} returnKeyType="done" />
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Aufgabe hinzufügen')} disabled={title.trim() === ''} style={[styles.iconButton, title.trim() === '' && styles.buttonDisabled]} onPress={add}>
          <Icon name="plus" size={22} />
        </Pressable>
      </View>
      {title.trim() !== '' ? (
        <Dropdown caption={t('Wiederholen')} value={repeat} options={REPEATS.map((choice) => ({ value: choice.kind, label: t(choice.label) }))} onChange={setRepeat} />
      ) : null}

      {tasks.length === 0 ? <Text style={[styles.hint, { marginTop: 16 }]}>{t('Für diesen Tag steht nichts auf der Liste.')}</Text> : null}
      <View style={tasks.length > 0 ? styles.menuCard : undefined}>
        {tasks.map((task, index) => (
          <View key={task.id} style={[styles.taskRow, index === tasks.length - 1 && styles.menuRowLast]}>
            <View style={styles.taskLine}>
              <Tick on={task.done} label={task.title} onPress={() => props.onDone(task.id, !task.done)} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.taskTitle, task.done && styles.taskDone]} numberOfLines={2}>
                  {task.title}
                </Text>
                {repeatText(task.recurrence) || task.notes ? <Text style={styles.itemMeta}>{[repeatText(task.recurrence), task.notes].filter((x) => x !== '').join(', ')}</Text> : null}
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={t('Mehr')} hitSlop={8} style={styles.taskMore} onPress={() => setMenuFor(task)}>
                <Icon name="more" size={20} />
              </Pressable>
            </View>
            {task.items.map((entry) => (
              <View key={entry.id} style={styles.taskPoint}>
                <Tick size={20} on={entry.doneOn === day} label={entry.title} onPress={() => props.onItem(entry.id, entry.doneOn !== day)} />
                <Text style={[styles.taskPointText, entry.doneOn === day && styles.taskDone]}>{entry.title}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={t('Punkt entfernen')} hitSlop={8} onPress={() => props.onRemoveItem(entry.id)}>
                  <Icon name="close" size={16} />
                </Pressable>
              </View>
            ))}
            {pointFor === task.id ? (
              <View style={styles.taskPoint}>
                <View style={{ flex: 1 }}>
                  <FormInput placeholder={t('Neuer Punkt')} value={point} onChangeText={setPoint} onSubmitEditing={addPoint} returnKeyType="done" autoFocus />
                </View>
                <Pressable accessibilityRole="button" style={styles.smallAction} onPress={addPoint}>
                  <Text style={styles.smallActionText}>{t('Punkt hinzufügen')}</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ))}
      </View>
      <ActionSheet visible={menuFor !== null} actions={menuFor ? actionsFor(menuFor) : []} onClose={() => setMenuFor(null)} />
    </FormScroll>
  )
}
