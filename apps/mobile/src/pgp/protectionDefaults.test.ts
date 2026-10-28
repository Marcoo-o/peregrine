import { describe, expect, it } from 'vitest'
import { addAccount, type NewAccount } from '../accounts'
import { migratedDatabase } from '../testing/testDb'
import { saveOwnKey } from './keyStore'
import { DEFAULT_PROTECTION, loadProtectionSettings, ProtectionDefaults, saveProtectionSettings } from './protectionDefaults'

const NEW_ACCOUNT: NewAccount = {
  displayName: 'Alex',
  emailAddress: 'alex@example.org',
  imapHost: 'imap.example.org',
  imapPort: 993,
  imapSecure: 'tls',
  imapUsername: 'alex',
  smtpHost: null,
  smtpPort: null,
  smtpSecure: null,
  smtpUsername: null,
  password: 'secret',
  smtpPassword: null
}

describe('what the user wants of every message', () => {
  it('is neither signed nor encrypted until they say so', async () => {
    const { db } = await migratedDatabase()
    expect(await loadProtectionSettings(db)).toEqual(DEFAULT_PROTECTION)
  })

  it('is kept as it is set, one switch at a time', async () => {
    const { db } = await migratedDatabase()
    await saveProtectionSettings(db, { sign: true })
    expect(await loadProtectionSettings(db)).toEqual({ sign: true, encrypt: false })
    await saveProtectionSettings(db, { encrypt: true })
    expect(await loadProtectionSettings(db)).toEqual({ sign: true, encrypt: true })
  })

  it('takes the default for what is stored and is not a switch, and for what cannot be read', async () => {
    const { db } = await migratedDatabase()
    await db.run('INSERT INTO settings (name, value) VALUES (?, ?)', 'pgp', JSON.stringify({ sign: 'yes', encrypt: true }))
    expect(await loadProtectionSettings(db)).toEqual({ sign: false, encrypt: true })
    await db.run('UPDATE settings SET value = ? WHERE name = ?', 'not json', 'pgp')
    expect(await loadProtectionSettings(db)).toEqual(DEFAULT_PROTECTION)
  })
})

describe('what a new message starts with', () => {
  async function start(settings: { sign?: boolean; encrypt?: boolean }, keyed: boolean) {
    const { db } = await migratedDatabase()
    const account = await addAccount(db, NEW_ACCOUNT)
    if (keyed) await saveOwnKey(db, { fingerprint: 'AAAA', accountId: account.id, publicKey: 'p', privateKey: 'k', createdAt: 1 })
    await saveProtectionSettings(db, settings)
    const defaults = new ProtectionDefaults(db)
    await defaults.load()
    return { defaults, account, db }
  }

  it('has the switches that are on, for an account that has a key', async () => {
    const t = await start({ sign: true, encrypt: true }, true)
    expect(t.defaults.forAccount(t.account.id)).toEqual({ sign: true, encrypt: true })
    const signOnly = await start({ sign: true }, true)
    expect(signOnly.defaults.forAccount(signOnly.account.id)).toEqual({ sign: true })
  })

  it('has nothing for an account without a key, which could not do it', async () => {
    const t = await start({ sign: true, encrypt: true }, false)
    expect(t.defaults.forAccount(t.account.id)).toEqual({})
  })

  it('has nothing before it was read, and when nothing is set', async () => {
    const { db } = await migratedDatabase()
    expect(new ProtectionDefaults(db).forAccount('any')).toEqual({})
    const t = await start({}, true)
    expect(t.defaults.forAccount(t.account.id)).toEqual({})
  })

  it('follows a change at once, and an account that gets its key later', async () => {
    const t = await start({}, false)
    await t.defaults.change({ sign: true })
    expect(t.defaults.forAccount(t.account.id)).toEqual({})
    await saveOwnKey(t.db, { fingerprint: 'AAAA', accountId: t.account.id, publicKey: 'p', privateKey: 'k', createdAt: 1 })
    await t.defaults.load()
    expect(t.defaults.forAccount(t.account.id)).toEqual({ sign: true })
  })
})
