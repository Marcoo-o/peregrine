import { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import type { FilterAction, FilterCondition, FilterMatchMode, FilterRule, FilterRuleInput } from '@peregrine/core/types'
import type { FilterRulesState } from '../app/screens'
import { ACTIONS, FIELDS, MATCH_MODES, NEW_ACTION, NEW_CONDITION, operatorsFor, ruleSummary } from '../filterRules'
import { t } from '../i18n'
import { Button, Chip, SwitchRow } from './controls'
import { ConfirmDialog } from './ConfirmDialog'
import { FormInput, FormScroll } from './FormScroll'
import { folderLabel } from './folderLabel'
import { Header } from './Header'
import { useStyles } from './useStyles'

/** What is being edited: one of the rules, a new one, or none, which is the list. */
type Editing = FilterRule | 'new' | null

interface Form {
  name: string
  matchMode: FilterMatchMode
  conditions: FilterCondition[]
  actions: FilterAction[]
}

const EMPTY: Form = { name: '', matchMode: 'all', conditions: [NEW_CONDITION], actions: [NEW_ACTION] }

/** The rules of an account that sort its mail as it arrives: a list to put in order and switch on and off, and a form to make or change one. */
export function FilterRulesScreen(props: {
  state: FilterRulesState
  onAccount: (accountId: string) => void
  onSave: (input: Omit<FilterRuleInput, 'accountId'>, id?: string) => void
  onRemove: (id: string) => void
  onEnabled: (id: string, enabled: boolean) => void
  onMove: (id: string, direction: -1 | 1) => void
  onApply: (id: string) => void
  onBack: () => void
}) {
  const styles = useStyles()
  const { accounts, account, rules, folders, notice, error } = props.state
  const [editing, setEditing] = useState<Editing>(null)
  const [form, setForm] = useState<Form>(EMPTY)
  const [removing, setRemoving] = useState(false)
  // What was done is said above the list, which is where the screen goes back to; a refusal leaves the form as it was typed.
  useEffect(() => {
    if (notice) setEditing(null)
  }, [notice, rules])
  const open = (next: Editing) => {
    setEditing(next)
    setForm(next === null || next === 'new' ? EMPTY : { name: next.name, matchMode: next.matchMode, conditions: next.conditions, actions: next.actions })
  }
  const folderName = (id: string) => {
    const folder = folders.find((candidate) => candidate.id === id)
    return folder ? folderLabel(folder) : undefined
  }
  const status = (
    <>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.hint}>{notice}</Text> : null}
    </>
  )

  if (editing === null) {
    return (
      <FormScroll>
        <Header title={t('Filterregeln')} back={{ label: t('Einstellungen'), onPress: props.onBack }} />
        {status}
        {accounts.length > 1 ? (
          <View style={styles.actions}>
            {accounts.map((candidate) => (
              <Chip key={candidate.id} label={candidate.displayName} active={candidate.id === account.id} onPress={() => props.onAccount(candidate.id)} />
            ))}
          </View>
        ) : null}
        <Text style={styles.hint}>
          {t('Regeln sortieren, was im Posteingang ankommt. Sie laufen in der Reihenfolge der Liste, jede, die zutrifft, wird angewendet. Sortiert wird beim Abrufen, also nur, wenn die App oder der Abruf im Hintergrund läuft.')}
        </Text>
        <Button label={t('Regel hinzufügen')} onPress={() => open('new')} />
        {rules.length === 0 ? <Text style={styles.hint}>{t('Noch keine Regeln.')}</Text> : null}
        {rules.map((rule, index) => (
          <View key={rule.id} style={styles.attachment}>
            <Pressable accessibilityRole="button" onPress={() => open(rule)}>
              <Text style={styles.itemTitle}>{rule.name}</Text>
              <Text style={styles.itemMeta}>{ruleSummary(rule, folderName)}</Text>
            </Pressable>
            <SwitchRow label={t('Eingeschaltet')} value={rule.enabled} onChange={(on) => props.onEnabled(rule.id, on)} />
            <View style={styles.actions}>
              <Chip label={t('Nach oben')} active={false} disabled={index === 0} onPress={() => props.onMove(rule.id, -1)} />
              <Chip label={t('Nach unten')} active={false} disabled={index === rules.length - 1} onPress={() => props.onMove(rule.id, 1)} />
              <Chip label={t('Jetzt anwenden')} active={false} onPress={() => props.onApply(rule.id)} />
            </View>
          </View>
        ))}
      </FormScroll>
    )
  }

  const current = editing === 'new' ? null : editing
  const setCondition = (at: number, change: Partial<FilterCondition>) =>
    setForm((now) => ({ ...now, conditions: now.conditions.map((condition, place) => (place === at ? { ...condition, ...change } : condition)) }))
  const setAction = (at: number, change: FilterAction) => setForm((now) => ({ ...now, actions: now.actions.map((action, place) => (place === at ? change : action)) }))

  return (
    <FormScroll>
      <Header title={current ? t('Regel ändern') : t('Neue Regel')} back={{ label: t('Filterregeln'), onPress: () => setEditing(null) }} />
      {status}
      <FormInput placeholder={t('Name der Regel')} value={form.name} onChangeText={(name) => setForm((now) => ({ ...now, name }))} />

      <Text style={styles.section}>{t('Wenn')}</Text>
      <View style={styles.actions}>
        {MATCH_MODES.map((choice) => (
          <Chip key={choice.mode} label={t(choice.label)} active={form.matchMode === choice.mode} onPress={() => setForm((now) => ({ ...now, matchMode: choice.mode }))} />
        ))}
      </View>
      {form.conditions.map((condition, at) => {
        const needsValue = !['isTrue', 'isFalse'].includes(condition.operator)
        return (
          <View key={at} style={styles.attachment}>
            <View style={styles.actions}>
              {FIELDS.map((choice) => (
                <Chip
                  key={choice.field}
                  label={t(choice.label)}
                  active={condition.field === choice.field}
                  onPress={() => setCondition(at, { field: choice.field, operator: operatorsFor(choice.field)[0].operator, value: '' })}
                />
              ))}
            </View>
            <View style={styles.actions}>
              {operatorsFor(condition.field).map((choice) => (
                <Chip key={choice.operator} label={t(choice.label)} active={condition.operator === choice.operator} onPress={() => setCondition(at, { operator: choice.operator })} />
              ))}
            </View>
            {needsValue ? (
              <FormInput
                placeholder={condition.field === 'sizeBytes' ? t('Größe in Byte') : t('Wert')}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType={condition.field === 'sizeBytes' ? 'numeric' : 'default'}
                value={condition.value}
                onChangeText={(value) => setCondition(at, { value })}
              />
            ) : null}
            {form.conditions.length > 1 ? (
              <Chip label={t('Bedingung entfernen')} active={false} onPress={() => setForm((now) => ({ ...now, conditions: now.conditions.filter((_, place) => place !== at) }))} />
            ) : null}
          </View>
        )
      })}
      <Button label={t('Bedingung hinzufügen')} variant="secondary" onPress={() => setForm((now) => ({ ...now, conditions: [...now.conditions, NEW_CONDITION] }))} />

      <Text style={styles.section}>{t('Dann')}</Text>
      {form.actions.map((action, at) => (
        <View key={at} style={styles.attachment}>
          <View style={styles.actions}>
            {ACTIONS.map((choice) => (
              <Chip key={choice.type} label={t(choice.label)} active={action.type === choice.type} onPress={() => setAction(at, { type: choice.type })} />
            ))}
          </View>
          {action.type === 'move' ? (
            <View style={styles.actions}>
              {folders.map((folder) => (
                <Chip key={folder.id} label={folderLabel(folder)} active={action.targetFolderId === folder.id} onPress={() => setAction(at, { type: 'move', targetFolderId: folder.id })} />
              ))}
            </View>
          ) : null}
          {form.actions.length > 1 ? (
            <Chip label={t('Aktion entfernen')} active={false} onPress={() => setForm((now) => ({ ...now, actions: now.actions.filter((_, place) => place !== at) }))} />
          ) : null}
        </View>
      ))}
      <Button label={t('Aktion hinzufügen')} variant="secondary" onPress={() => setForm((now) => ({ ...now, actions: [...now.actions, NEW_ACTION] }))} />

      <Button label={t('Speichern')} onPress={() => props.onSave(form, current?.id)} />
      {current ? <Button label={t('Regel entfernen')} variant="danger" onPress={() => setRemoving(true)} /> : null}
      <ConfirmDialog
        visible={removing}
        title={t('Regel entfernen?')}
        text={t('Die Regel wird von diesem Telefon entfernt. Was sie schon sortiert hat, bleibt, wo es ist.')}
        answers={[
          { label: t('Abbrechen'), onPress: () => setRemoving(false) },
          {
            label: t('Regel entfernen'),
            variant: 'danger',
            onPress: () => {
              setRemoving(false)
              setEditing(null)
              if (current) props.onRemove(current.id)
            }
          }
        ]}
      />
    </FormScroll>
  )
}
