import Database from 'better-sqlite3-multiple-ciphers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PENDING_ACTIONS_SCHEMA } from '@peregrine/core/pendingActionsStore'
import { closeDb, openDb } from './db'
import type { BetterSqliteDb } from './sqlDb'

/**
 * The queue's table as the desktop has it after all its migrations, against the one the phone
 * creates from `PENDING_ACTIONS_SCHEMA`. The storage functions are written once and run on both,
 * so a column that one side lacks is a query that fails on one side only, and it would be found on a
 * phone.
 */

let desktop: BetterSqliteDb
beforeEach(() => {
  desktop = openDb(':memory:', null)
})
afterEach(() => closeDb())

interface Column {
  name: string
  type: string
  notnull: number
  dflt_value: string | null
  pk: number
}

async function desktopColumns(): Promise<Column[]> {
  return desktop.all<Column>('SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info(?)', 'pending_actions')
}

function shared() {
  const raw = new Database(':memory:')
  for (const statement of PENDING_ACTIONS_SCHEMA) raw.exec(statement)
  return raw
}

describe('the table of the offline queue', () => {
  it('has the same columns on the phone as on the desktop', async () => {
    const phone = shared().prepare('SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info(?)').all('pending_actions') as Column[]
    expect(phone.length).toBeGreaterThan(5)
    expect(phone).toEqual(await desktopColumns())
  })

  it('has the same indexes, partial ones included', async () => {
    const indexes = (rows: { name: string; partial: number }[]) => rows.map((r) => `${r.name}:${r.partial}`).sort()
    const sql = "SELECT name, \"partial\" AS partial FROM pragma_index_list(?) WHERE name LIKE 'idx_pending%'"
    const phone = shared().prepare(sql).all('pending_actions') as { name: string; partial: number }[]
    const there = await desktop.all<{ name: string; partial: number }>(sql, 'pending_actions')
    expect(indexes(phone)).toEqual(indexes(there))
    expect(indexes(phone)).toContain('idx_pending_due:1')
  })

  it('can be created again without harm, as a migration that is run twice would', () => {
    const raw = shared()
    expect(() => PENDING_ACTIONS_SCHEMA.forEach((statement) => raw.exec(statement))).not.toThrow()
  })
})
