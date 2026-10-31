import { useEffect, useState } from 'react'
import { Pressable, Switch, Text, View } from 'react-native'
import type { FilterAction, FilterCondition, FilterMatchMode, FilterRule, FilterRuleInput } from '@peregrine/core/types'
import type { FilterRulesState } from '../app/screens'
import { ACTIONS, FIELDS, MATCH_MODES, NEW_ACTION, NEW_CONDITION, operatorsFor, ruleSummary } from '../filterRules'
import { t } from '../i18n'
import { Button } from './controls'
import { ActionSheet } from './ActionSheet'
import { Icon } from './Icon'
import { Dropdown } from './Dropdown'
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
  const [menuFor, setMenuFor] = useState<{ rule: FilterRule; index: number } | null>(null)
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
          <Dropdown caption={t('Konto')} value={account.id} options={accounts.map((candidate) => ({ value: candidate.id, label: candidate.displayName }))} onChange={props.onAccount} />
        ) : null}
        <Text style={styles.hint}>
          {t('Regeln sortieren, was im Posteingang ankommt. Sie laufen in der Reihenfolge der Liste, jede, die zutrifft, wird angewendet. Sortiert wird beim Abrufen, also nur, wenn die App oder der Abruf im Hintergrund läuft.')}
        </Text>
        <Button label={t('Regel hinzufügen')} onPress={() => open('new')} />
        {rules.length === 0 ? <Text style={styles.hint}>{t('Noch keine Regeln.')}</Text> : null}
        <View style={rules.length > 0 ? styles.menuCard : undefined}>
          {rules.map((rule, index) => (
            <View key={rule.id} style={[styles.menuRow, index === rules.length - 1 && styles.menuRowLast]}>
              <Pressable accessibilityRole="button" style={{ flex: 1, paddingVertical: 8 }} onPress={() => open(rule)}>
                <Text style={styles.itemTitle}>{rule.name}</Text>
                <Text style={styles.itemMeta}>{ruleSummary(rule, folderName)}</Text>
              </Pressable>
              <Switch value={rule.enabled} onValueChange={(on) => props.onEnabled(rule.id, on)} />
              <Pressable accessibilityRole="button" accessibilityLabel={t('Mehr')} hitSlop={8} onPress={() => setMenuFor({ rule, index })}>
                <Icon name="more" size={20} />
              </Pressable>
            </View>
          ))}
        </View>
        <ActionSheet
          visible={menuFor !== null}
          actions={
            menuFor
              ? [
                  { label: t('Jetzt anwenden'), onPress: () => props.onApply(menuFor.rule.id) },
                  ...(menuFor.index > 0 ? [{ label: t('Nach oben'), onPress: () => props.onMove(menuFor.rule.id, -1) }] : []),
                  ...(menuFor.index < rules.length - 1 ? [{ label: t('Nach unten'), onPress: () => props.onMove(menuFor.rule.id, 1) }] : [])
                ]
              : []
          }
          onClose={() => setMenuFor(null)}
        />
      </FormScroll>
    )
  }

  const current = editing === 'new' ? null : editing
  const setCondition = (at: number, change: Partial<FilterCondition>) =>
    setForm((now) => ({ ...now, conditions: now.conditions.map((condition, place) => (place === at ? { ...condition, ...change } : condition)) }))
  const setAction = (at: number, change: FilterAction) => setForm((now) => ({ ...now, actions: now.actions.map((action, place) => (place === at ? change : action)) }))
  const fieldOptions = FIELDS.map((choice) => ({ value: choice.field, label: t(choice.label) }))
  const actionOptions = ACTIONS.map((choice) => ({ value: choice.type, label: t(choice.label) }))
  const modeOptions = MATCH_MODES.map((choice) => ({ value: choice.mode, label: t(choice.label) }))
  const folderOptions = folders.map((folder) => ({ value: folder.id, label: folderLabel(folder) }))

  return (
    <FormScroll>
      <Header title={current ? t('Regel ändern') : t('Neue Regel')} back={{ label: t('Filterregeln'), onPress: () => setEditing(null) }} />
      {status}
      <FormInput placeholder={t('Name der Regel')} value={form.name} onChangeText={(name) => setForm((now) => ({ ...now, name }))} />

      <Text style={styles.section}>{t('Wenn')}</Text>
      <Dropdown value={form.matchMode} options={modeOptions} onChange={(matchMode) => setForm((now) => ({ ...now, matchMode }))} />
      {form.conditions.map((condition, at) => {
        const needsValue = !['isTrue', 'isFalse'].includes(condition.operator)
        const operatorOptions = operatorsFor(condition.field).map((choice) => ({ value: choice.operator, label: t(choice.label) }))
        return (
          <View key={at} style={styles.ruleBlock}>
            <View style={styles.fieldRow}>
              <Dropdown
                caption={t('Feld')}
                value={condition.field}
                options={fieldOptions}
                onChange={(field) => setCondition(at, { field, operator: operatorsFor(field)[0].operator, value: '' })}
              />
              <Dropdown caption={t('Vergleich')} value={condition.operator} options={operatorOptions} onChange={(operator) => setCondition(at, { operator })} />
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
              <Pressable accessibilityRole="button" style={styles.smallAction} onPress={() => setForm((now) => ({ ...now, conditions: now.conditions.filter((_, place) => place !== at) }))}>
                <Text style={styles.smallActionDanger}>{t('Bedingung entfernen')}</Text>
              </Pressable>
            ) : null}
          </View>
        )
      })}
      <Pressable accessibilityRole="button" style={styles.smallAction} onPress={() => setForm((now) => ({ ...now, conditions: [...now.conditions, NEW_CONDITION] }))}>
        <Text style={styles.smallActionText}>+ {t('Bedingung hinzufügen')}</Text>
      </Pressable>

      <Text style={styles.section}>{t('Dann')}</Text>
      {form.actions.map((action, at) => (
        <View key={at} style={styles.ruleBlock}>
          <View style={styles.fieldRow}>
            <Dropdown caption={t('Aktion')} value={action.type} options={actionOptions} onChange={(type) => setAction(at, type === 'move' ? { type, targetFolderId: action.targetFolderId } : { type })} />
            {action.type === 'move' ? (
              <Dropdown
                caption={t('Ordner')}
                value={action.targetFolderId ?? null}
                options={folderOptions}
                placeholder={t('Wählen')}
                onChange={(targetFolderId) => setAction(at, { type: 'move', targetFolderId })}
              />
            ) : null}
          </View>
          {form.actions.length > 1 ? (
            <Pressable accessibilityRole="button" style={styles.smallAction} onPress={() => setForm((now) => ({ ...now, actions: now.actions.filter((_, place) => place !== at) }))}>
              <Text style={styles.smallActionDanger}>{t('Aktion entfernen')}</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
      <Pressable accessibilityRole="button" style={styles.smallAction} onPress={() => setForm((now) => ({ ...now, actions: [...now.actions, NEW_ACTION] }))}>
        <Text style={styles.smallActionText}>+ {t('Aktion hinzufügen')}</Text>
      </Pressable>

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
