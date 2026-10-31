import type { FilterRule } from '@peregrine/core/types'
import { describe, expect, it } from 'vitest'
import { removeAccount } from './accounts'
import { getFolder } from './folders'
import { actionsFor, listRules, moveRule, operatorsFor, removeRule, ruleProblem, saveRule, setRuleEnabled } from './filterRules'
import { appHarness } from './testing/appHarness'
import type { FilterRulesState } from './app/screens'

const rule = (over: Partial<FilterRule> = {}): FilterRule => ({
  id: 'r1',
  accountId: 'a',
  name: 'rule',
  matchMode: 'all',
  conditions: [{ field: 'subject', operator: 'contains', value: 'invoice' }],
  actions: [{ type: 'markRead' }],
  enabled: true,
  priority: 0,
  ...over
})

const message = (over: Partial<Parameters<typeof actionsFor>[1]> = {}) => ({
  subject: 'Your invoice',
  from: [{ name: 'Shop', address: 'shop@example.net' }],
  to: [],
  cc: [],
  textBody: null,
  sizeBytes: 100,
  hasAttachments: false,
  ...over
})

describe('what a rule needs to be kept', () => {
  const ok = { name: 'Invoices', conditions: rule().conditions, actions: rule().actions }

  it('is a name, a condition with a value, and an action', () => {
    expect(ruleProblem(ok)).toBeNull()
    expect(ruleProblem({ ...ok, name: '  ' })).toContain('Namen')
    expect(ruleProblem({ ...ok, conditions: [] })).toContain('Bedingung')
    expect(ruleProblem({ ...ok, conditions: [{ field: 'subject', operator: 'contains', value: ' ' }] })).toContain('Wert')
    expect(ruleProblem({ ...ok, actions: [] })).toContain('Aktion')
  })

  it('wants a number for a size, a pattern that is one, and a folder for a move', () => {
    expect(ruleProblem({ ...ok, conditions: [{ field: 'sizeBytes', operator: 'greaterThan', value: 'big' }] })).toContain('Zahl')
    expect(ruleProblem({ ...ok, conditions: [{ field: 'sizeBytes', operator: 'greaterThan', value: '5000' }] })).toBeNull()
    expect(ruleProblem({ ...ok, conditions: [{ field: 'subject', operator: 'regex', value: '(' }] })).toContain('Muster')
    expect(ruleProblem({ ...ok, actions: [{ type: 'move' }] })).toContain('Ordner')
  })

  it('needs no value for the attachment, and offers the ways of comparing that fit the field', () => {
    expect(ruleProblem({ ...ok, conditions: [{ field: 'hasAttachment', operator: 'isTrue', value: '' }] })).toBeNull()
    expect(operatorsFor('subject').map((o) => o.operator)).toContain('regex')
    expect(operatorsFor('sizeBytes').map((o) => o.operator)).toEqual(['greaterThan', 'lessThan', 'equals'])
    expect(operatorsFor('hasAttachment').map((o) => o.operator)).toEqual(['isTrue', 'isFalse'])
  })
})

describe('what the rules do with a message', () => {
  it('is what the rules that match say, in the order of the list', () => {
    const rules = [rule({ actions: [{ type: 'markRead' }] }), rule({ id: 'r2', actions: [{ type: 'flag' }] })]
    expect(actionsFor(rules, message())).toEqual([{ type: 'markRead' }, { type: 'flag' }])
    expect(actionsFor(rules, message({ subject: 'Hello' }))).toEqual([])
  })

  it('skips a rule that is off, and takes all of the conditions or any of them as the rule says', () => {
    const two = [
      { field: 'subject' as const, operator: 'contains' as const, value: 'invoice' },
      { field: 'from' as const, operator: 'contains' as const, value: 'nobody' }
    ]
    expect(actionsFor([rule({ enabled: false })], message())).toEqual([])
    expect(actionsFor([rule({ conditions: two })], message())).toEqual([])
    expect(actionsFor([rule({ conditions: two, matchMode: 'any' })], message())).toEqual([{ type: 'markRead' }])
  })

  it('ends at a move or a delete, since the message is not where the rest would act, and at a stop', () => {
    const move = { type: 'move' as const, targetFolderId: 'f' }
    expect(actionsFor([rule({ actions: [move, { type: 'flag' }] }), rule({ id: 'r2' })], message())).toEqual([move])
    expect(actionsFor([rule({ actions: [{ type: 'delete' }] }), rule({ id: 'r2' })], message())).toEqual([{ type: 'delete' }])
    expect(actionsFor([rule({ actions: [{ type: 'flag' }, { type: 'stop' }] }), rule({ id: 'r2' })], message())).toEqual([{ type: 'flag' }])
  })

  it('judges the size, and does not match the text, which is not fetched with the headers', () => {
    const big = rule({ conditions: [{ field: 'sizeBytes', operator: 'greaterThan', value: '50' }] })
    expect(actionsFor([big], message())).toHaveLength(1)
    const text = rule({ conditions: [{ field: 'body', operator: 'contains', value: 'x' }] })
    expect(actionsFor([text], message())).toEqual([])
  })
})

describe('keeping the rules', () => {
  async function withAccount() {
    const t = await appHarness()
    const work = await t.givenAccount('work', { INBOX: [], Archive: [], Trash: [] })
    return { ...t, work }
  }
  const input = (accountId: string, name: string) => ({ accountId, name, matchMode: 'all' as const, conditions: rule().conditions, actions: rule().actions })

  it('puts a new rule at the end, and changes one where it is', async () => {
    const t = await withAccount()
    const first = await saveRule(t.db, input(t.work.id, 'First'))
    const second = await saveRule(t.db, input(t.work.id, 'Second'))
    if (!('saved' in first) || !('saved' in second)) throw new Error('not saved')
    expect((await listRules(t.db, t.work.id)).map((r) => r.name)).toEqual(['First', 'Second'])
    await saveRule(t.db, { ...input(t.work.id, 'Renamed'), actions: [{ type: 'flag' }] }, first.saved.id)
    const [changed] = await listRules(t.db, t.work.id)
    expect(changed).toMatchObject({ name: 'Renamed', actions: [{ type: 'flag' }], enabled: true })
  })

  it('does not keep one that is not whole', async () => {
    const t = await withAccount()
    expect(await saveRule(t.db, { ...input(t.work.id, ''), actions: [] })).toHaveProperty('problem')
    expect(await listRules(t.db, t.work.id)).toEqual([])
  })

  it('orders them, switches them off and on, and removes them', async () => {
    const t = await withAccount()
    const ids: string[] = []
    for (const name of ['A', 'B', 'C']) {
      const made = await saveRule(t.db, input(t.work.id, name))
      if ('saved' in made) ids.push(made.saved.id)
    }
    await moveRule(t.db, ids[2], -1)
    expect((await listRules(t.db, t.work.id)).map((r) => r.name)).toEqual(['A', 'C', 'B'])
    await moveRule(t.db, ids[0], -1)
    await moveRule(t.db, ids[1], 1)
    expect((await listRules(t.db, t.work.id)).map((r) => r.name)).toEqual(['A', 'C', 'B'])
    await setRuleEnabled(t.db, ids[0], false)
    expect((await listRules(t.db, t.work.id))[0].enabled).toBe(false)
    await removeRule(t.db, ids[0])
    expect((await listRules(t.db, t.work.id)).map((r) => r.name)).toEqual(['C', 'B'])
  })

  it('go when their account goes', async () => {
    const t = await withAccount()
    await saveRule(t.db, input(t.work.id, 'First'))
    await removeAccount(t.db, t.work.id)
    expect(await t.db.all('SELECT * FROM filter_rules')).toEqual([])
  })
})

describe('sorting what arrives', () => {
  async function arriving() {
    const t = await appHarness()
    const work = await t.givenAccount('work', { INBOX: [{ uid: 1, subject: 'Old' }], Archive: [], Trash: [] })
    await t.app.navigator.start()
    const folders = await t.db.all<{ id: string; imap_path: string }>('SELECT id, imap_path FROM folders WHERE account_id = ?', work.id)
    const id = (path: string) => folders.find((f) => f.imap_path === path)?.id as string
    const inbox = () => t.server.mailboxes.get('work')!.INBOX
    return { ...t, work, id, inbox }
  }
  it('moves, marks and flags the mail that comes into the inbox, and only that', async () => {
    const t = await arriving()
    await saveRule(t.db, {
      accountId: t.work.id,
      name: 'Invoices',
      matchMode: 'all',
      conditions: [{ field: 'subject', operator: 'contains', value: 'invoice' }],
      actions: [{ type: 'markRead' }, { type: 'flag' }, { type: 'move', targetFolderId: t.id('Archive') }]
    })
    t.inbox().push({ uid: 2, subject: 'Your invoice' }, { uid: 3, subject: 'Hello' })
    const folder = getFolder(t.db, t.id('INBOX'))
    await t.app.navigator.showMessages(t.work, (await folder) as never, { sync: true })
    expect(t.server.calls).toEqual(expect.arrayContaining(['add INBOX 2 \\Seen', 'add INBOX 2 \\Flagged']))
    expect(t.server.calls.some((call) => call.startsWith('move INBOX > Archive 2'))).toBe(true)
    const left = await t.db.all<{ uid: number }>('SELECT uid FROM messages WHERE folder_id = ? ORDER BY uid', t.id('INBOX'))
    expect(left.map((m) => m.uid)).toEqual([1, 3])
  })

  it('does nothing when no rule is on, and does not stop the sync when an action fails', async () => {
    const t = await arriving()
    const made = await saveRule(t.db, {
      accountId: t.work.id,
      name: 'Off',
      matchMode: 'all',
      conditions: [{ field: 'subject', operator: 'contains', value: 'invoice' }],
      actions: [{ type: 'flag' }]
    })
    if ('saved' in made) await setRuleEnabled(t.db, made.saved.id, false)
    t.inbox().push({ uid: 2, subject: 'Your invoice' })
    const folder = await getFolder(t.db, t.id('INBOX'))
    await t.app.navigator.showMessages(t.work, folder as never, { sync: true })
    expect(t.server.calls.some((call) => call.startsWith('add '))).toBe(false)

    await setRuleEnabled(t.db, (made as { saved: FilterRule }).saved.id, true)
    t.server.refuseFlags = 'read only'
    t.inbox().push({ uid: 3, subject: 'Another invoice' })
    await t.app.navigator.showMessages(t.work, folder as never, { sync: true })
    const stored = await t.db.all<{ uid: number }>('SELECT uid FROM messages WHERE folder_id = ?', t.id('INBOX'))
    expect(stored.map((m) => m.uid).sort()).toEqual([1, 2, 3])
  })

  it('applies one rule to what is in the inbox already, and says how many it sorted', async () => {
    const t = await arriving()
    t.inbox().push({ uid: 2, subject: 'Your invoice' }, { uid: 3, subject: 'Another invoice' })
    const folder = await getFolder(t.db, t.id('INBOX'))
    await t.app.navigator.showMessages(t.work, folder as never, { sync: true })
    const made = await saveRule(t.db, {
      accountId: t.work.id,
      name: 'Invoices',
      matchMode: 'all',
      conditions: [{ field: 'subject', operator: 'contains', value: 'invoice' }],
      actions: [{ type: 'move', targetFolderId: t.id('Archive') }]
    })
    await t.app.filters.show(t.work.id)
    await t.app.filters.applyNow(t.work.id, (made as { saved: FilterRule }).saved.id)
    expect((t.store.screen as FilterRulesState).notice).toBe('2 Nachrichten wurden sortiert.')
    const left = await t.db.all<{ uid: number }>('SELECT uid FROM messages WHERE folder_id = ?', t.id('INBOX'))
    expect(left.map((m) => m.uid)).toEqual([1])
  })
})

describe('the screen for the rules', () => {
  it('shows the rules of the account, says what was done, and says why a rule was not kept', async () => {
    const t = await appHarness()
    const work = await t.givenAccount('work', { INBOX: [] })
    await t.app.filters.show()
    expect(t.store.screen).toMatchObject({ name: 'filterRules', rules: [], account: { id: work.id } })
    await t.app.filters.save(work.id, { name: '', matchMode: 'all', conditions: [], actions: [] })
    expect((t.store.screen as FilterRulesState).error).toContain('Namen')
    await t.app.filters.save(work.id, { name: 'Mark', matchMode: 'all', conditions: rule().conditions, actions: [{ type: 'flag' }] })
    const shown = t.store.screen as FilterRulesState
    expect(shown.notice).toBe('Gespeichert.')
    expect(shown.rules).toHaveLength(1)
    await t.app.filters.remove(work.id, shown.rules[0].id)
    expect((t.store.screen as FilterRulesState).rules).toEqual([])
  })

  it('asks for a connection when a rule is applied to what is there and there is none', async () => {
    const t = await appHarness()
    const work = await t.givenAccount('work', { INBOX: [] })
    const made = await saveRule(t.db, { accountId: work.id, name: 'X', matchMode: 'all', conditions: rule().conditions, actions: rule().actions })
    await t.app.filters.applyNow(work.id, (made as { saved: FilterRule }).saved.id)
    expect((t.store.screen as FilterRulesState).error).toContain('Verbindung')
  })
})
