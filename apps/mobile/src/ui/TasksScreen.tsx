import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import type { Recurrence } from '@peregrine/core/recurrence'
import { parseRecurrence } from '@peregrine/core/recurrence'
import type { TasksState } from '../app/screens'
import { REPEATS, today, type DayTask } from '../tasks'
import { t, language } from '../i18n'
import { Button, Chip, SwitchRow } from './controls'
import { FormInput, FormScroll } from './FormScroll'
import { Header } from './Header'
import { useStyles } from './useStyles'

/** How a rule reads in a line under the title. */
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

/** The daily list: what is due today, to tick, with a checklist where a task has one, and a form for a new task. */
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
  const [adding, setAdding] = useState<string | null>(null)
  const [item, setItem] = useState('')
  const open = tasks.filter((task) => !task.done).length

  return (
    <FormScroll>
      <Header title={t('Aufgaben')} back={{ label: t('Konten'), onPress: props.onBack }} />
      <Text style={styles.hint}>{dayText(day)}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.hint}>{notice}</Text> : null}
      {tasks.length === 0 ? <Text style={styles.hint}>{t('Für diesen Tag steht nichts auf der Liste.')}</Text> : <Text style={styles.hint}>{t('{count} offen', { count: open })}</Text>}
      {tasks.map((task) => (
        <View key={task.id} style={styles.attachment}>
          <SwitchRow label={task.title} hint={[repeatText(task.recurrence), task.notes].filter((x) => x !== '').join(', ')} value={task.done} onChange={(done) => props.onDone(task.id, done)} />
          {task.items.map((entry) => (
            <View key={entry.id}>
              <SwitchRow label={entry.title} value={entry.doneOn === day} onChange={(done) => props.onItem(entry.id, done)} />
              <Pressable accessibilityRole="button" onPress={() => props.onRemoveItem(entry.id)}>
                <Text style={styles.link}>{t('Punkt entfernen')}</Text>
              </Pressable>
            </View>
          ))}
          {adding === task.id ? (
            <>
              <FormInput placeholder={t('Neuer Punkt')} value={item} onChangeText={setItem} onSubmitEditing={() => { props.onAddItem(task.id, item); setItem(''); setAdding(null) }} />
              <Button label={t('Punkt hinzufügen')} variant="secondary" disabled={item.trim() === ''} onPress={() => { props.onAddItem(task.id, item); setItem(''); setAdding(null) }} />
            </>
          ) : null}
          <View style={styles.actions}>
            {task.link ? <Chip label={t('Nachricht öffnen')} active={false} onPress={() => props.onOpenMessage(task)} /> : null}
            <Chip label={t('Checkliste')} active={adding === task.id} onPress={() => setAdding(adding === task.id ? null : task.id)} />
            {parseRecurrence(task.recurrence).kind === 'once' ? <Chip label={t('Auf morgen')} active={false} onPress={() => props.onDefer(task.id)} /> : null}
            <Chip label={t('Entfernen')} active={false} onPress={() => props.onRemove(task.id)} />
          </View>
        </View>
      ))}

      <Text style={styles.section}>{t('Neue Aufgabe')}</Text>
      <FormInput placeholder={t('Titel')} value={title} onChangeText={setTitle} />
      <View style={styles.actions}>
        {REPEATS.map((choice) => (
          <Chip key={choice.kind} label={t(choice.label)} active={repeat === choice.kind} onPress={() => setRepeat(choice.kind)} />
        ))}
      </View>
      <Button
        label={t('Aufgabe hinzufügen')}
        disabled={title.trim() === ''}
        onPress={() => {
          props.onAdd(title, repeat)
          setTitle('')
          setRepeat('once')
        }}
      />
    </FormScroll>
  )
}
