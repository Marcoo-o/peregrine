import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, Download, Pencil, Play, Plus, Trash2, X } from 'lucide-react'
import type {
  FilterAction,
  FilterActionType,
  FilterCondition,
  FilterConditionField,
  FilterMatchMode,
  FilterOperator,
  FilterRule,
  FolderNode
} from '@peregrine/core/types'
import { toastError, toastInfo } from '@renderer/state/toastStore'

interface FilterRulesSectionProps {
  accountId: string
}

const conditionFields: FilterConditionField[] = [
  'from',
  'to',
  'cc',
  'subject',
  'body',
  'sizeBytes',
  'hasAttachment'
]
const actionTypes: FilterActionType[] = ['move', 'markRead', 'markUnread', 'flag', 'delete', 'stop']

const TEXT_OPERATORS: FilterOperator[] = [
  'contains',
  'notContains',
  'equals',
  'startsWith',
  'endsWith',
  'regex'
]
const NUMBER_OPERATORS: FilterOperator[] = ['greaterThan', 'lessThan', 'equals']
const BOOLEAN_OPERATORS: FilterOperator[] = ['isTrue', 'isFalse']

/** Which operators make sense depends on the field's type, not on the field itself. */
function operatorsFor(field: FilterConditionField): FilterOperator[] {
  if (field === 'sizeBytes') return NUMBER_OPERATORS
  if (field === 'hasAttachment') return BOOLEAN_OPERATORS
  return TEXT_OPERATORS
}

interface DraftRule {
  ruleId?: string
  name: string
  matchMode: FilterMatchMode
  conditions: FilterCondition[]
  actions: FilterAction[]
}

function emptyDraft(): DraftRule {
  return {
    name: '',
    matchMode: 'all',
    conditions: [{ field: 'from', operator: 'contains', value: '' }],
    actions: [{ type: 'move', targetFolderId: null }]
  }
}

function FilterRulesSection({ accountId }: FilterRulesSectionProps): JSX.Element {
  const { t } = useTranslation()
  const [rules, setRules] = useState<FilterRule[]>([])
  const [folders, setFolders] = useState<FolderNode[]>([])
  const [draft, setDraft] = useState<DraftRule | null>(null)
  const [busy, setBusy] = useState(false)
  /** Rules Thunderbird had that could not be taken over, with the reason. */
  const [skipped, setSkipped] = useState<{ name: string; reason: string }[]>([])

  async function reload(): Promise<void> {
    const [ruleList, folderList] = await Promise.all([
      window.peregrine.filterRules.list(accountId),
      window.peregrine.folders.list(accountId)
    ])
    setRules(ruleList)
    setFolders(folderList)
  }

  useEffect(() => {
    void reload()
    setDraft(null)
    setSkipped([])
  }, [accountId])

  async function handleImportThunderbird(): Promise<void> {
    setBusy(true)
    try {
      const result = await window.peregrine.filterRules.importThunderbird(accountId)
      if (!result) {
        toastInfo(t('settings.thunderbirdNoProfile'))
        return
      }
      setSkipped(result.skipped)
      toastInfo(t('settings.rulesImported', { count: result.imported }))
      await reload()
    } catch (err) {
      toastError(err, t('settings.importThunderbirdRules'))
    } finally {
      setBusy(false)
    }
  }

  function folderName(folderId: string | null | undefined): string {
    return folders.find((f) => f.id === folderId)?.displayName ?? ''
  }

  function describe(rule: FilterRule): string {
    const conditions = rule.conditions
      .map(
        (condition) =>
          `${t(`settings.field.${condition.field}`)} ${t(`settings.operator.${condition.operator}`)} ${
            condition.value ? `"${condition.value}"` : ''
          }`.trim()
      )
      .join(rule.matchMode === 'all' ? ` ${t('settings.matchAll')} ` : ` ${t('settings.matchAny')} `)

    const actions = rule.actions
      .map(
        (action) =>
          `${t(`settings.action.${action.type}`)}${
            action.type === 'move' ? ` (${folderName(action.targetFolderId)})` : ''
          }`
      )
      .join(', ')

    return `${conditions} → ${actions}`
  }

  async function run<T>(action: () => Promise<T>, errorKey: string): Promise<void> {
    setBusy(true)
    try {
      await action()
      await reload()
    } catch (err) {
      toastError(err, t(errorKey))
    } finally {
      setBusy(false)
    }
  }

  async function handleSave(): Promise<void> {
    if (!draft || !draft.name.trim()) return
    const payload = {
      accountId,
      name: draft.name.trim(),
      matchMode: draft.matchMode,
      conditions: draft.conditions.filter(
        (condition) =>
          condition.value.trim() !== '' ||
          condition.operator === 'isTrue' ||
          condition.operator === 'isFalse'
      ),
      actions: draft.actions
    }
    if (payload.conditions.length === 0) return

    await run(async () => {
      if (draft.ruleId) await window.peregrine.filterRules.update({ ...payload, ruleId: draft.ruleId })
      else await window.peregrine.filterRules.create(payload)
    }, 'settings.ruleSaveFailed')
    setDraft(null)
  }

  async function handleMove(index: number, delta: number): Promise<void> {
    const next = [...rules]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    await run(
      () =>
        window.peregrine.filterRules.reorder({
          accountId,
          ruleIds: next.map((rule) => rule.id)
        }),
      'settings.ruleSaveFailed'
    )
  }

  async function handleApply(rule: FilterRule): Promise<void> {
    const inbox = folders.find((folder) => folder.specialUse === 'inbox') ?? folders[0]
    if (!inbox) return
    await run(async () => {
      const { matched } = await window.peregrine.filterRules.applyToFolder({
        accountId,
        folderId: inbox.id,
        ruleId: rule.id
      })
      toastInfo(t('settings.ruleApplied', { count: matched, folder: inbox.displayName }))
    }, 'settings.ruleApplyFailed')
  }

  function updateCondition(index: number, patch: Partial<FilterCondition>): void {
    setDraft((current) =>
      current
        ? {
            ...current,
            conditions: current.conditions.map((condition, i) =>
              i === index ? { ...condition, ...patch } : condition
            )
          }
        : current
    )
  }

  function updateAction(index: number, patch: Partial<FilterAction>): void {
    setDraft((current) =>
      current
        ? {
            ...current,
            actions: current.actions.map((action, i) =>
              i === index ? { ...action, ...patch } : action
            )
          }
        : current
    )
  }

  return (
    <section className="settings-section">
      <div className="settings-section-header">
        <h3>{t('settings.filterRules')}</h3>
        <button onClick={() => void handleImportThunderbird()} disabled={busy}>
          <Download size={15} strokeWidth={1.75} />
          {t('settings.importThunderbirdRules')}
        </button>
        <button onClick={() => setDraft(emptyDraft())} disabled={busy}>
          <Plus size={15} strokeWidth={1.75} />
          {t('settings.addRule')}
        </button>
      </div>

      {/* Named one by one rather than counted: a rule that was left out is one the user has
          to write again, and they cannot do that without knowing which. */}
      {skipped.length > 0 && (
        <ul className="settings-hint">
          {skipped.map((rule) => (
            <li key={rule.name}>{t('settings.ruleSkipped', rule)}</li>
          ))}
        </ul>
      )}

      <ul className="filter-rule-list">
        {rules.map((rule, index) => (
          <li key={rule.id} className="filter-rule-row">
            <input
              type="checkbox"
              checked={rule.enabled}
              onChange={() =>
                void run(
                  () =>
                    window.peregrine.filterRules.setEnabled({
                      ruleId: rule.id,
                      enabled: !rule.enabled
                    }),
                  'settings.ruleSaveFailed'
                )
              }
              aria-label={t('settings.ruleEnabled')}
            />
            <div className="filter-rule-info">
              <span className="filter-rule-name">{rule.name}</span>
              <span className="filter-rule-detail">{describe(rule)}</span>
            </div>
            <button
              className="icon-button"
              onClick={() => void handleMove(index, -1)}
              disabled={index === 0}
              aria-label={t('settings.moveRuleUp')}
              title={t('settings.moveRuleUp')}
            >
              <ArrowUp size={14} strokeWidth={1.75} />
            </button>
            <button
              className="icon-button"
              onClick={() => void handleMove(index, 1)}
              disabled={index === rules.length - 1}
              aria-label={t('settings.moveRuleDown')}
              title={t('settings.moveRuleDown')}
            >
              <ArrowDown size={14} strokeWidth={1.75} />
            </button>
            <button
              className="icon-button"
              onClick={() => void handleApply(rule)}
              aria-label={t('settings.applyRule')}
              title={t('settings.applyRule')}
            >
              <Play size={14} strokeWidth={1.75} />
            </button>
            <button
              className="icon-button"
              onClick={() =>
                setDraft({
                  ruleId: rule.id,
                  name: rule.name,
                  matchMode: rule.matchMode,
                  conditions: rule.conditions.length > 0 ? rule.conditions : emptyDraft().conditions,
                  actions: rule.actions.length > 0 ? rule.actions : emptyDraft().actions
                })
              }
              aria-label={t('settings.editRule')}
              title={t('settings.editRule')}
            >
              <Pencil size={14} strokeWidth={1.75} />
            </button>
            <button
              className="icon-button"
              onClick={() =>
                void run(
                  () => window.peregrine.filterRules.delete(rule.id),
                  'settings.ruleSaveFailed'
                )
              }
              aria-label={t('settings.deleteRule')}
              title={t('settings.deleteRule')}
            >
              <Trash2 size={14} strokeWidth={1.75} />
            </button>
          </li>
        ))}
      </ul>

      {draft && (
        <div className="rule-editor">
          <div className="rule-editor-head">
            <input
              placeholder={t('settings.ruleName')}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <select
              value={draft.matchMode}
              onChange={(e) => setDraft({ ...draft, matchMode: e.target.value as FilterMatchMode })}
            >
              <option value="all">{t('settings.matchModeAll')}</option>
              <option value="any">{t('settings.matchModeAny')}</option>
            </select>
          </div>

          {draft.conditions.map((condition, index) => (
            <div className="rule-row" key={index}>
              <select
                value={condition.field}
                onChange={(e) => {
                  const field = e.target.value as FilterConditionField
                  updateCondition(index, { field, operator: operatorsFor(field)[0] })
                }}
              >
                {conditionFields.map((field) => (
                  <option key={field} value={field}>
                    {t(`settings.field.${field}`)}
                  </option>
                ))}
              </select>
              <select
                value={condition.operator}
                onChange={(e) =>
                  updateCondition(index, { operator: e.target.value as FilterOperator })
                }
              >
                {operatorsFor(condition.field).map((operator) => (
                  <option key={operator} value={operator}>
                    {t(`settings.operator.${operator}`)}
                  </option>
                ))}
              </select>
              {condition.field !== 'hasAttachment' && (
                <input
                  value={condition.value}
                  placeholder={
                    condition.field === 'sizeBytes' ? t('settings.sizeInBytes') : t('settings.value')
                  }
                  onChange={(e) => updateCondition(index, { value: e.target.value })}
                />
              )}
              <button
                className="icon-button"
                aria-label={t('settings.removeCondition')}
                disabled={draft.conditions.length === 1}
                onClick={() =>
                  setDraft({
                    ...draft,
                    conditions: draft.conditions.filter((_, i) => i !== index)
                  })
                }
              >
                <X size={13} strokeWidth={2} />
              </button>
            </div>
          ))}
          <button
            className="rule-add-row"
            onClick={() =>
              setDraft({
                ...draft,
                conditions: [
                  ...draft.conditions,
                  { field: 'from', operator: 'contains', value: '' }
                ]
              })
            }
          >
            <Plus size={13} strokeWidth={2} />
            {t('settings.addCondition')}
          </button>

          {draft.actions.map((action, index) => (
            <div className="rule-row" key={`action-${index}`}>
              <select
                value={action.type}
                onChange={(e) => updateAction(index, { type: e.target.value as FilterActionType })}
              >
                {actionTypes.map((type) => (
                  <option key={type} value={type}>
                    {t(`settings.action.${type}`)}
                  </option>
                ))}
              </select>
              {action.type === 'move' && (
                <select
                  value={action.targetFolderId ?? ''}
                  onChange={(e) => updateAction(index, { targetFolderId: e.target.value })}
                >
                  <option value="">{t('settings.chooseFolder')}</option>
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.displayName}
                    </option>
                  ))}
                </select>
              )}
              <button
                className="icon-button"
                aria-label={t('settings.removeAction')}
                disabled={draft.actions.length === 1}
                onClick={() =>
                  setDraft({ ...draft, actions: draft.actions.filter((_, i) => i !== index) })
                }
              >
                <X size={13} strokeWidth={2} />
              </button>
            </div>
          ))}
          <button
            className="rule-add-row"
            onClick={() =>
              setDraft({ ...draft, actions: [...draft.actions, { type: 'markRead' }] })
            }
          >
            <Plus size={13} strokeWidth={2} />
            {t('settings.addAction')}
          </button>

          <div className="rule-editor-actions">
            <button onClick={() => setDraft(null)}>{t('compose.cancel')}</button>
            <button className="primary" onClick={handleSave} disabled={busy || !draft.name.trim()}>
              {t('settings.save')}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

export default FilterRulesSection
