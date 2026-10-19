import type { SqlDb } from '../db/sqlDb'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseThunderbirdFilters, type ImportableFilterRule } from '@peregrine/core/thunderbirdFilters'
import type { FilterAction } from '@peregrine/core/types'
import { createFilterRule, setFilterRuleEnabled } from '../db/repositories/filterRulesRepo'
import { getAccount } from '../db/repositories/accountsRepo'
import { listFolders } from '../db/repositories/foldersRepo'
import { scanThunderbird } from './thunderbird'

export interface FilterImportResult {
  imported: number
  /** Rule names that were read but could not be taken over, with the reason. */
  skipped: { name: string; reason: string }[]
}

/**
 * Finds the rules file belonging to one Peregrine account.
 *
 * Matched by address rather than by host: Thunderbird numbers the mail directory when
 * several accounts sit on one server (`mail.example-1.com`), so the folder name says
 * nothing, while the address is what both sides agree on.
 */
function rulesFileFor(profilePath: string, emailAddress: string): string | null {
  const { accounts } = scanThunderbird(profilePath)
  const match = accounts.find(
    (account) => account.emailAddress.toLowerCase() === emailAddress.toLowerCase()
  )
  if (!match || !match.directoryRel) return null
  const path = join(profilePath, match.directoryRel, 'msgFilterRules.dat')
  return existsSync(path) ? path : null
}

/**
 * Finds the folder a move action names.
 *
 * Thunderbird writes the path with slashes regardless of what the server separates with, so
 * a folder stored here as `Archiv.2026` has to be recognised from `Archiv/2026`. Falling
 * back to the display name catches the case where only the leaf was written.
 */
async function findFolderId(db: SqlDb, accountId: string, target: string): Promise<string | null> {
  if (!target) return null
  const folders = await listFolders(db, accountId)
  const wanted = target.toLowerCase()

  const byPath = folders.find(
    (folder) => folder.imapPath.replace(/[./]/g, '/').toLowerCase() === wanted
  )
  if (byPath) return byPath.id

  const leaf = wanted.split('/').pop() ?? wanted
  return folders.find((folder) => folder.displayName.toLowerCase() === leaf)?.id ?? null
}

/** Turns one parsed rule into the actions this application knows, or says why it cannot. */
async function convert(
  db: SqlDb,
  accountId: string,
  rule: ImportableFilterRule
): Promise<{ actions: FilterAction[] } | { reason: string }> {
  if (rule.conditions.length === 0) {
    return { reason: rule.unsupported[0] ?? 'noConditions' }
  }

  const actions: FilterAction[] = rule.actions.map((type) => ({ type }))

  if (rule.moveTarget) {
    const targetFolderId = await findFolderId(db, accountId, rule.moveTarget)
    // A move without a folder is not a rule with one action fewer, it is a different rule.
    if (!targetFolderId) return { reason: rule.moveTarget }
    actions.unshift({ type: 'move', targetFolderId })
  }

  if (actions.length === 0) return { reason: rule.unsupported[0] ?? 'noActions' }
  return { actions }
}

/**
 * Takes the filter rules of one account over from Thunderbird.
 *
 * Rules are added, never replaced. Whoever runs this twice ends up with duplicates, which is
 * visible and undoable, unlike an import that quietly overwrote a rule written by hand.
 */
export async function importThunderbirdFilters(
  db: SqlDb,
  accountId: string,
  explicitProfilePath?: string
): Promise<FilterImportResult | null> {
  const account = await getAccount(db, accountId)
  if (!account) return null

  const { profilePath } = scanThunderbird(explicitProfilePath)
  if (!profilePath) return null

  const rulesFile = rulesFileFor(profilePath, account.emailAddress)
  if (!rulesFile) return { imported: 0, skipped: [] }

  let text: string
  try {
    text = readFileSync(rulesFile, 'utf8')
  } catch {
    return { imported: 0, skipped: [] }
  }

  const result: FilterImportResult = { imported: 0, skipped: [] }
  for (const rule of parseThunderbirdFilters(text)) {
    const converted = await convert(db, accountId, rule)
    if ('reason' in converted) {
      result.skipped.push({ name: rule.name, reason: converted.reason })
      continue
    }
    const ruleId = await createFilterRule(db, {
      accountId,
      name: rule.name,
      matchMode: rule.matchMode,
      conditions: rule.conditions,
      actions: converted.actions
    })
    // New rules start out enabled, so a rule switched off in Thunderbird has to be switched
    // off again here. Importing it as active would have it act on mail on the next sync.
    if (!rule.enabled) await setFilterRuleEnabled(db, ruleId, false)
    result.imported += 1
  }

  return result
}
