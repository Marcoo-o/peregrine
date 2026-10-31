import type { FilterRuleInput } from '@peregrine/core/types'
import { listAccounts } from '../accounts'
import { explainError } from '../errors'
import { applyRules, getRule, isInboxFolder, listRules, moveRule, removeRule, saveRule, setRuleEnabled } from '../filterRules'
import { listFolders } from '../folders'
import { t, tn } from '../i18n'
import type { Services } from './services'
import type { AppStore } from './store'

/** How many messages are asked of the server at once when a rule is applied to what is there. */
const CHUNK = 100

/** The rules that sort the mail of an account: seen, made, changed, ordered, switched on and off, and applied to what is in the inbox already. */
export class FilterRulesController {
  constructor(
    private readonly services: Services,
    private readonly store: AppStore
  ) {}

  /** The rules of an account (the first when none is named), with a line about what was just done or what went wrong. */
  async show(accountId?: string, notice?: string, error?: string): Promise<void> {
    const accounts = await listAccounts(this.services.db)
    const account = accounts.find((candidate) => candidate.id === accountId) ?? accounts[0]
    if (!account) return
    this.store.showScreen({
      name: 'filterRules',
      accounts,
      account,
      rules: await listRules(this.services.db, account.id),
      folders: await listFolders(this.services.db, account.id),
      notice,
      error
    })
  }

  /** Keeps a rule: a new one when `id` is not given, else the change of that one. A rule that cannot be kept says why and the form stays as it was typed. */
  async save(accountId: string, input: Omit<FilterRuleInput, 'accountId'>, id?: string): Promise<void> {
    const result = await saveRule(this.services.db, { ...input, accountId }, id)
    if ('problem' in result) await this.show(accountId, undefined, result.problem)
    else await this.show(accountId, t('Gespeichert.'))
  }

  async remove(accountId: string, id: string): Promise<void> {
    await removeRule(this.services.db, id)
    await this.show(accountId, t('Die Regel ist entfernt.'))
  }

  async setEnabled(accountId: string, id: string, enabled: boolean): Promise<void> {
    await setRuleEnabled(this.services.db, id, enabled)
    await this.show(accountId)
  }

  /** One place earlier (-1) or later (1) in the order the rules run in. */
  async move(accountId: string, id: string, direction: -1 | 1): Promise<void> {
    await moveRule(this.services.db, id, direction)
    await this.show(accountId)
  }

  /**
   * Applies one rule to the messages of the inbox that the phone has, whether or not it is switched on. What the server is asked for is the
   * addresses of the messages, which the cache does not keep, so a condition on them is judged on what the server says.
   */
  async applyNow(accountId: string, id: string): Promise<void> {
    const { db, connections } = this.services
    const rule = await getRule(db, id)
    if (!rule) return
    const imap = connections.get(accountId)
    if (!imap) return this.show(accountId, undefined, t('Dafür braucht es eine Verbindung zum Server, und die gibt es gerade nicht.'))
    const inbox = (await listFolders(db, accountId)).find(isInboxFolder)
    if (!inbox) return this.show(accountId, undefined, t('Dieses Konto hat keinen Posteingang.'))
    try {
      const uids = (await db.all<{ uid: number }>('SELECT uid FROM messages WHERE folder_id = ? ORDER BY uid DESC', inbox.id)).map((row) => row.uid)
      let matched = 0
      let failed = 0
      let problem: string | undefined
      for (let at = 0; at < uids.length; at += CHUNK) {
        const fetched = await imap.fetchMessages(inbox.imapPath, uids.slice(at, at + CHUNK))
        const run = await applyRules(imap, db, inbox, fetched, [{ ...rule, enabled: true }])
        matched += run.matched
        failed += run.failed
        problem ??= run.firstProblem
      }
      if (failed > 0) {
        await this.show(accountId, undefined, t('{count} Aktionen gingen nicht: {problem}', { count: failed, problem: problem ?? '' }))
        return
      }
      await this.show(accountId, tn(matched, '{count} Nachricht wurde sortiert.', '{count} Nachrichten wurden sortiert.'))
    } catch (error) {
      await this.show(accountId, undefined, explainError(error))
    }
  }
}
