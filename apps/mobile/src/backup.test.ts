import { nodeBackupCipher } from '../../../packages/core/test-support/backupCipherNode'
import type { SqlDb } from '@peregrine/core/sqlDb'
import { describe, expect, it } from 'vitest'
import { addAccount, listAccounts, type NewAccount } from './accounts'
import { BACKED_UP_SETTINGS, bundleBytes, collectBackup, countsOf, makeBackup, openBackup, restoreBackup } from './backup'
import { saveContact } from './contactBook'
import { saveRule } from './filterRules'
import { listIdentities } from './identities'
import { saveOwnKey, saveContactKey, listOwnKeys, listContactKeys } from './pgp/keyStore'
import { addTask, setItemDone, setTaskDone, tasksForDay } from './tasks'
import { createTag, listTags } from './tags'
import { migratedDatabase } from './testing/testDb'

const ACCOUNT: NewAccount = {
  displayName: 'Alex',
  emailAddress: 'alex@example.org',
  imapHost: 'imap.example.org',
  imapPort: 993,
  imapSecure: 'tls',
  imapUsername: 'alex',
  smtpHost: 'smtp.example.org',
  smtpPort: 587,
  smtpSecure: 'starttls',
  smtpUsername: null,
  password: 'imap-secret',
  smtpPassword: 'smtp-secret'
}

const fast = nodeBackupCipher({ rounds: 1000 })

async function addFolder(db: SqlDb, accountId: string, path: string): Promise<string> {
  const id = `folder-${path}-${accountId}`
  await db.run('INSERT INTO folders (id, account_id, imap_path, display_name, special_use, parent_path) VALUES (?, ?, ?, ?, ?, ?)', id, accountId, path, path, null, null)
  return id
}

/** A phone with something of everything on it. */
async function full() {
  const { db } = await migratedDatabase()
  const account = await addAccount(db, ACCOUNT)
  await db.run('UPDATE identities SET signature = ? WHERE account_id = ?', 'Alex, example.org', account.id)
  const archive = await addFolder(db, account.id, 'Archive')
  await saveOwnKey(db, { fingerprint: 'AAAA', accountId: account.id, publicKey: 'PUBLIC-A', privateKey: 'PRIVATE-A', createdAt: 10 })
  await saveContactKey(db, { fingerprint: 'BBBB', address: 'Sam@Example.net', publicKey: 'PUBLIC-B', createdAt: 11 })
  await saveContact(db, { name: 'Sam', address: 'sam@example.net' })
  await createTag(db, 'Work', '#2f5d9f')
  await saveRule(db, {
    accountId: account.id,
    name: 'Invoices',
    matchMode: 'all',
    conditions: [{ field: 'subject', operator: 'contains', value: 'invoice' }],
    actions: [{ type: 'flag' }, { type: 'move', targetFolderId: archive }]
  })
  const task = await addTask(db, { title: 'Call Sam', recurrence: 'daily', items: ['Number'] }, '2026-11-02')
  if ('problem' in task) throw new Error('no task')
  await setTaskDone(db, task.id, '2026-11-02', true)
  await setItemDone(db, (await tasksForDay(db, '2026-11-02'))[0].items[0].id, '2026-11-02')
  await db.run("INSERT INTO settings (name, value) VALUES ('language', '{\"choice\":\"de\"}'), ('lock', '{\"on\":true}'), ('notifications', '{}')")
  return { db, account, archive }
}

describe('what a backup holds', () => {
  it('is what the user made, counted, and not what is of the device or the server', async () => {
    const { db, account } = await full()
    const bundle = await collectBackup(db, { passwords: true, privateKeys: true }, 5)
    expect(countsOf(bundle)).toEqual({ accounts: 1, identities: 1, keys: 2, contacts: 1, tags: 1, rules: 1, tasks: 1, settings: 1 })
    expect(bundle).toMatchObject({ app: 'peregrine', version: 1, createdAt: 5 })
    expect(bundle.accounts[0]).toMatchObject({ id: account.id, emailAddress: 'alex@example.org', password: 'imap-secret', smtpPassword: 'smtp-secret' })
    expect(bundle.identities[0]).toMatchObject({ signature: 'Alex, example.org', isDefault: true })
    // The lock and the notifications are of this device.
    expect(Object.keys(bundle.settings)).toEqual(['language'])
    expect(BACKED_UP_SETTINGS).not.toContain('lock')
  })

  it('has no password and no private key unless they were asked for', async () => {
    const { db } = await full()
    const text = new TextDecoder().decode(bundleBytes(await collectBackup(db, { passwords: false, privateKeys: false })))
    for (const secret of ['imap-secret', 'smtp-secret', 'PRIVATE-A']) expect(text).not.toContain(secret)
    expect(text).toContain('PUBLIC-A')
    const withThem = new TextDecoder().decode(bundleBytes(await collectBackup(db, { passwords: true, privateKeys: true })))
    for (const secret of ['imap-secret', 'smtp-secret', 'PRIVATE-A']) expect(withThem).toContain(secret)
  })

  it('names the folder of a move by its path, since the id is the phone\'s', async () => {
    const { db } = await full()
    const [rule] = (await collectBackup(db, { passwords: false, privateKeys: false })).rules
    expect(rule.actions).toEqual([{ type: 'flag' }, { type: 'move', targetPath: 'Archive' }])
  })
})

describe('the file of a backup of the phone', () => {
  it('is opened with the password, and says why when it cannot be', async () => {
    const { db } = await full()
    const { file, counts } = await makeBackup(db, fast, 'pw', { passwords: false, privateKeys: true })
    expect(counts.accounts).toBe(1)
    expect(await openBackup(fast, file, 'pw')).toMatchObject({ bundle: { app: 'peregrine', accounts: [{ emailAddress: 'alex@example.org' }] } })
    expect(await openBackup(fast, file, 'wrong')).toEqual({ problem: 'password' })
    expect(await openBackup(fast, new Uint8Array(100), 'pw')).toEqual({ problem: 'password' })
  })

  it('is not read when it opens and is not a bundle, or is of a newer version', async () => {
    const seal = (content: string) => fast.seal(new TextEncoder().encode(content), 'pw')
    expect(await openBackup(fast, await seal('not json'), 'pw')).toEqual({ problem: 'notBackup' })
    expect(await openBackup(fast, await seal('{"app":"other","version":1}'), 'pw')).toEqual({ problem: 'notBackup' })
    expect(await openBackup(fast, await seal('{"app":"peregrine","version":99}'), 'pw')).toEqual({ problem: 'newer' })
  })

  it('is read with the lists that a version left out as empty ones', async () => {
    const opened = await openBackup(fast, await fast.seal(new TextEncoder().encode('{"app":"peregrine","version":1,"createdAt":1,"accounts":[]}'), 'pw'), 'pw')
    expect(opened).toMatchObject({ bundle: { rules: [], tasks: [], settings: {}, contacts: [] } })
  })
})

describe('putting a backup back', () => {
  async function restored(options = { passwords: true, privateKeys: true }) {
    const original = await full()
    const bundle = await collectBackup(original.db, options)
    const { db } = await migratedDatabase()
    return { original, bundle, db, result: await restoreBackup(db, bundle) }
  }

  it('adds everything onto an empty phone, and says what was added', async () => {
    const { db, result, original } = await restored()
    expect(result.added).toEqual({ accounts: 1, identities: 1, keys: 2, contacts: 1, tags: 1, rules: 0, tasks: 1, settings: 1 })
    expect(result.known).toEqual({ accounts: 0, identities: 0, keys: 0, contacts: 0, tags: 0, rules: 0, tasks: 0, settings: 0 })
    const [account] = await listAccounts(db)
    expect(account).toMatchObject({ emailAddress: 'alex@example.org', password: 'imap-secret', smtpPassword: 'smtp-secret', color: original.account.color })
    expect(account.id).not.toBe(original.account.id)
    expect(await listIdentities(db, account.id)).toMatchObject([{ signature: 'Alex, example.org', isDefault: true }])
    expect(await listOwnKeys(db, account.id)).toMatchObject([{ fingerprint: 'AAAA', privateKey: 'PRIVATE-A' }])
    expect((await listContactKeys(db)).map((key) => key.address)).toEqual(['sam@example.net'])
    expect((await listTags(db)).map((tag) => tag.keyword)).toHaveLength(1)
    const [task] = await tasksForDay(db, '2026-11-02')
    expect(task).toMatchObject({ title: 'Call Sam', done: true, items: [{ title: 'Number', doneOn: '2026-11-02' }] })
    expect(await db.get('SELECT value FROM settings WHERE name = ?', 'language')).toEqual({ value: '{"choice":"de"}' })
  })

  it('leaves what is there as it is, and counts it as there, when it is put back twice', async () => {
    const { db, bundle } = await restored()
    const again = await restoreBackup(db, bundle)
    expect(again.added).toEqual({ accounts: 0, identities: 0, keys: 0, contacts: 0, tags: 0, rules: 0, tasks: 0, settings: 0 })
    expect(again.known).toMatchObject({ accounts: 1, identities: 1, keys: 2, contacts: 1, tags: 1, tasks: 1, settings: 1 })
    expect(await listAccounts(db)).toHaveLength(1)
  })

  it('does not replace what the user has changed since: a setting, a signature, a password', async () => {
    const { db, bundle } = await restored()
    const [account] = await listAccounts(db)
    await db.run("UPDATE settings SET value = '{\"choice\":\"en\"}' WHERE name = 'language'")
    await db.run('UPDATE identities SET signature = ? WHERE account_id = ?', 'Changed', account.id)
    await db.run('UPDATE accounts SET password = ? WHERE id = ?', 'new-password', account.id)
    await restoreBackup(db, bundle)
    expect(await db.get('SELECT value FROM settings WHERE name = ?', 'language')).toEqual({ value: '{"choice":"en"}' })
    expect((await listIdentities(db, account.id))[0].signature).toBe('Changed')
    expect((await listAccounts(db))[0].password).toBe('new-password')
  })

  it('adds an account that has no password when the file had none, and says so', async () => {
    const { db, result } = await restored({ passwords: false, privateKeys: false })
    expect(result.accountsWithoutPassword).toBe(1)
    expect((await listAccounts(db))[0].password).toBe('')
  })

  it('keeps only the public half of an own key when the file has no private halves', async () => {
    const { db, result } = await restored({ passwords: true, privateKeys: false })
    const [account] = await listAccounts(db)
    expect(await listOwnKeys(db, account.id)).toEqual([])
    expect((await listContactKeys(db)).map((key) => key.fingerprint).sort()).toEqual(['AAAA', 'BBBB'])
    expect(result.added.keys).toBe(2)
  })

  it('adds the rules whose folder is on the phone, and waits with the others until it is', async () => {
    const { db, bundle, result } = await restored()
    expect(result.rulesWithoutFolder).toBe(1)
    const [account] = await listAccounts(db)
    await addFolder(db, account.id, 'Archive')
    const second = await restoreBackup(db, bundle)
    expect(second.added.rules).toBe(1)
    expect(second.rulesWithoutFolder).toBe(0)
    const [rule] = await db.all<{ actions_json: string }>('SELECT actions_json FROM filter_rules')
    expect(JSON.parse(rule.actions_json)).toEqual([{ type: 'flag' }, { type: 'move', targetFolderId: `folder-Archive-${account.id}` }])
    const third = await restoreBackup(db, bundle)
    expect(third.known.rules).toBe(1)
    expect(third.added.rules).toBe(0)
  })

  it('adds what is new onto an account that is there already, by the identity of the account and not its id', async () => {
    const { bundle } = await restored()
    const { db } = await migratedDatabase()
    const mine = await addAccount(db, { ...ACCOUNT, displayName: 'Mine', password: 'mine' })
    await saveContact(db, { name: 'Other', address: 'other@example.net' })
    const result = await restoreBackup(db, bundle)
    expect(result.added.accounts).toBe(0)
    expect(result.known.accounts).toBe(1)
    expect(await listAccounts(db)).toHaveLength(1)
    expect((await listAccounts(db))[0]).toMatchObject({ displayName: 'Mine', password: 'mine' })
    // What belongs to the account is added to it.
    expect((await listOwnKeys(db, mine.id)).map((key) => key.fingerprint)).toEqual(['AAAA'])
    expect(await db.get('SELECT COUNT(*) AS n FROM contacts')).toEqual({ n: 2 })
  })

  it('leaves out what is of an account the file does not have, and what is not a setting of a backup', async () => {
    const { db, bundle } = await restored()
    const odd = { ...bundle, identities: [...bundle.identities, { accountId: 'gone', displayName: 'x', emailAddress: 'x@example.net', signature: '', isDefault: false, sortOrder: 5 }], settings: { ...bundle.settings, lock: '{"on":true}' } }
    const result = await restoreBackup(db, odd)
    expect(result.skipped).toBe(2)
    expect(await db.get('SELECT 1 AS found FROM settings WHERE name = ?', 'lock')).toBeUndefined()
  })

  it('is the same as before after a trip through the file', async () => {
    const original = await full()
    const { file } = await makeBackup(original.db, fast, 'pw', { passwords: true, privateKeys: true })
    const opened = await openBackup(fast, file, 'pw')
    if (!('bundle' in opened)) throw new Error('not opened')
    const { db } = await migratedDatabase()
    const result = await restoreBackup(db, opened.bundle)
    expect(result.added.accounts).toBe(1)
    expect(countsOf(await collectBackup(db, { passwords: true, privateKeys: true }))).toEqual({ ...countsOf(await collectBackup(original.db, { passwords: true, privateKeys: true })), rules: 0 })
  })
})
