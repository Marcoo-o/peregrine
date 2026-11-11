import { describe, expect, it } from 'vitest'
import { listAccounts } from '../accounts'
import { openBackup } from '../backup'
import { saveContact } from '../contactBook'
import { appHarness } from '../testing/appHarness'
import { countsText } from '../backup'
import { backupFileName } from './BackupController'
import type { BackupState } from './screens'

const OPTIONS = { passwords: true, privateKeys: true }

async function withData() {
  const t = await appHarness()
  const work = await t.givenAccount('work', { INBOX: [] }, { password: 'demo-secret' })
  await saveContact(t.db, { name: 'Sam', address: 'sam@example.net' })
  const shown = () => t.store.screen as BackupState
  return { ...t, work, shown }
}

describe('making a backup', () => {
  it('wants a password of some length, twice the same, and makes nothing without', async () => {
    const t = await withData()
    await t.app.backup.make('short', 'short', OPTIONS)
    expect(t.shown().error).toContain('mindestens 8')
    await t.app.backup.make('long enough', 'long enough!', OPTIONS)
    expect(t.shown().error).toContain('nicht gleich')
    expect(t.files.saved).toEqual([])
  })

  it('saves a file that opens with the password, and says what is in it', async () => {
    const t = await withData()
    await t.app.backup.make('long enough', 'long enough', OPTIONS)
    expect(t.files.saved).toHaveLength(1)
    const [saved] = t.files.saved
    expect(saved.name).toMatch(/^peregrine-backup-\d{4}-\d{2}-\d{2}_\d{4}\.pgbk$/)
    expect(t.shown().notice).toContain('1 Konto')
    expect(t.shown().notice).toContain('1 Kontakt')
    expect(await openBackup(t.app.backup['services'].backupCipher, saved.content, 'long enough')).toMatchObject({ bundle: { accounts: [{ password: 'demo-secret' }] } })
  })

  it('has no passwords in the file unless they were asked for', async () => {
    const t = await withData()
    await t.app.backup.make('long enough', 'long enough', { passwords: false, privateKeys: false })
    const opened = await openBackup(t.app.backup['services'].backupCipher, t.files.saved[0].content, 'long enough')
    expect(JSON.stringify(opened)).not.toContain('demo-secret')
  })

  it('says nothing when the user chose no place to save it', async () => {
    const t = await withData()
    t.files.saveAnswer = false
    await t.app.backup.make('long enough', 'long enough', OPTIONS)
    expect(t.shown()).toMatchObject({ name: 'backup', notice: undefined, error: undefined })
  })

  it('says why when it could not be saved', async () => {
    const t = await withData()
    t.files.failWith = new Error('no space')
    await t.app.backup.make('long enough', 'long enough', OPTIONS)
    expect(t.shown().error).toContain('no space')
  })
})

describe('putting a backup back', () => {
  async function aBackup() {
    const source = await withData()
    await source.app.backup.make('long enough', 'long enough', OPTIONS)
    return source.files.saved[0].content
  }

  function pick(t: Awaited<ReturnType<typeof appHarness>>, content: Uint8Array, name = 'b.pgbk') {
    t.files.picked.length = 0
    t.files.picked.push({ path: `/store/1/${name}`, name, size: content.length, contentType: 'application/octet-stream' })
    t.files.stored.set(`/store/1/${name}`, content)
  }

  it('adds what is in it to an empty phone, tells how much, reads the settings again, and removes the copy of the file', async () => {
    const content = await aBackup()
    const t = await appHarness()
    pick(t, content)
    await t.app.backup.restore('long enough')
    const shown = t.store.screen as BackupState
    expect(shown.notice).toContain('Zurückgespielt: 1 Konto')
    expect(shown.notice).toContain('1 Kontakt')
    expect((await listAccounts(t.db)).map((account) => account.emailAddress)).toEqual(['work@example.org'])
    expect(t.files.removed).toContain('/store/1/b.pgbk')
  })

  it('says it again as there already when it is put back twice', async () => {
    const content = await aBackup()
    const t = await appHarness()
    pick(t, content)
    await t.app.backup.restore('long enough')
    await t.app.backup.restore('long enough')
    expect((t.store.screen as BackupState).notice).toContain('Schon da: 1 Konto')
    expect(await listAccounts(t.db)).toHaveLength(1)
  })

  it('says the password is wrong, and adds nothing', async () => {
    const content = await aBackup()
    const t = await appHarness()
    pick(t, content)
    await t.app.backup.restore('not the password')
    expect((t.store.screen as BackupState).error).toContain('Passwort stimmt nicht')
    expect(await listAccounts(t.db)).toEqual([])
  })

  it('asks for the password first, does nothing when no file was picked, and refuses a file that is too large', async () => {
    const t = await appHarness()
    await t.app.backup.restore('')
    expect((t.store.screen as BackupState).error).toContain('Passwort')
    await t.app.backup.show()
    await t.app.backup.restore('long enough')
    expect(t.store.screen).toMatchObject({ name: 'backup', error: undefined, notice: undefined })
    t.files.picked.push({ path: '/store/2/big', name: 'big', size: 60 * 1024 * 1024, contentType: 'application/octet-stream' })
    await t.app.backup.restore('long enough')
    expect((t.store.screen as BackupState).error).toContain('zu groß')
  })

  it('tells the accounts that have no password yet, when the file had none', async () => {
    const source = await withData()
    await source.app.backup.make('long enough', 'long enough', { passwords: false, privateKeys: true })
    const t = await appHarness()
    pick(t, source.files.saved[0].content)
    await t.app.backup.restore('long enough')
    expect((t.store.screen as BackupState).notice).toContain('braucht noch sein Passwort')
  })
})

describe('the words for a backup', () => {
  it('counts what there is and leaves out what is nought', () => {
    expect(countsText({ accounts: 1, identities: 0, keys: 2, contacts: 0, tags: 0, rules: 3, tasks: 0, settings: 0 })).toBe('1 Konto, 2 Schlüssel, 3 Regeln')
    expect(countsText({ accounts: 0, identities: 0, keys: 0, contacts: 0, tags: 0, rules: 0, tasks: 0, settings: 0 })).toBe('nichts')
  })

  it('names the file by the day and the minute', () => {
    expect(backupFileName(new Date(2026, 10, 9, 8, 5))).toBe('peregrine-backup-2026-11-09_0805.pgbk')
  })
})
