import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, openDb, rekeyDb } from './db'

const KEY = 'a'.repeat(64)
const OTHER_KEY = 'b'.repeat(64)

let directory: string
let file: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'peregrine-db-'))
  file = join(directory, 'mail.db')
})

afterEach(() => {
  closeDb()
  rmSync(directory, { recursive: true, force: true })
})

describe('opening a profile', () => {
  it('refuses the wrong key', () => {
    openDb(file, KEY)
    closeDb()

    expect(() => openDb(file, OTHER_KEY)).toThrow()
  })

  // The handle used to be kept by the module even when opening failed, and the caller closed it.
  // The module has nothing to close any more, so opening has to clean up after itself. On
  // Windows a file that is still open cannot be removed.
  it('leaves no handle behind after a wrong key', () => {
    openDb(file, KEY)
    closeDb()
    expect(() => openDb(file, OTHER_KEY)).toThrow()

    expect(() => rmSync(directory, { recursive: true })).not.toThrow()
  })

  it('can be opened again with the right key afterwards', async () => {
    openDb(file, KEY)
    closeDb()
    expect(() => openDb(file, OTHER_KEY)).toThrow()

    const db = openDb(file, KEY)

    expect(await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM accounts')).toEqual({ n: 0 })
  })
})

describe('changing the key', () => {
  it('encrypts a database that had no password', async () => {
    const db = openDb(file, null)
    await rekeyDb(db, KEY)
    closeDb()

    expect(() => openDb(file, null)).toThrow()
    closeDb()
    expect(() => openDb(file, KEY)).not.toThrow()
  })

  it('removes the password again', async () => {
    const db = openDb(file, KEY)
    await rekeyDb(db, null)
    closeDb()

    expect(() => openDb(file, null)).not.toThrow()
  })

  // SQLCipher refuses to rekey in WAL mode, so the journal is switched away and back. Forgetting
  // the way back would leave every later write in the slower mode without anything saying so.
  it('puts the journal back into WAL mode', async () => {
    const db = openDb(file, null)

    await rekeyDb(db, KEY)

    expect(await db.get<{ journal_mode: string }>('PRAGMA journal_mode')).toEqual({
      journal_mode: 'wal'
    })
  })
})
