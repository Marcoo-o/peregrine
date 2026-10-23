import { describe, expect, it } from 'vitest'
import { addAccount, type Account } from '../accounts'
import { saveNotificationSettings } from '../settings'
import { FakePush } from '../testing/appHarness'
import { migratedDatabase } from '../testing/testDb'
import { applyPush, forgetPush, pushSourceOf } from './push'

const newAccount = (name: string, secure: 'tls' | 'starttls' | 'none' = 'tls') => ({
  displayName: name,
  emailAddress: `${name}@example.org`,
  imapHost: `imap.${name}.example.org`,
  imapPort: secure === 'tls' ? 993 : 143,
  imapSecure: secure,
  imapUsername: name,
  smtpHost: null,
  smtpPort: null,
  smtpSecure: null,
  smtpUsername: null,
  password: `${name}-secret`,
  smtpPassword: null
})

async function withAccounts(...secures: Array<'tls' | 'starttls' | 'none'>) {
  const { db } = await migratedDatabase()
  const accounts: Account[] = []
  for (const [index, secure] of secures.entries()) accounts.push(await addAccount(db, newAccount(`a${index}`, secure), { now: index + 1 }))
  const push = new FakePush()
  const errors: string[] = []
  return { db, accounts, push, errors, deps: { db, push, log: { error: (message: string) => void errors.push(message) } } }
}

describe('what the push service is told of an account', () => {
  it('is where to connect and with what, for the inbox, and the account is the source', async () => {
    const t = await withAccounts('tls')
    expect(pushSourceOf(t.accounts[0])).toEqual({
      sourceId: t.accounts[0].id,
      host: 'imap.a0.example.org',
      port: 993,
      security: 'tls',
      username: 'a0',
      password: 'a0-secret',
      mailbox: 'INBOX'
    })
  })

  it('takes a connection that starts encrypted later as it is, and none that is not encrypted at all', async () => {
    const t = await withAccounts('starttls', 'none')
    expect(pushSourceOf(t.accounts[0])?.security).toBe('starttls')
    expect(pushSourceOf(t.accounts[1])).toBeUndefined()
  })
})

describe('telling the push service what to watch', () => {
  it('does nothing where the device has no push service', async () => {
    const t = await withAccounts('tls')
    await saveNotificationSettings(t.db, { enabled: true })
    t.push.present = false
    await applyPush(t.deps)
    expect(t.push.calls).toEqual([])
  })

  it('takes everything out when notifications are off', async () => {
    const t = await withAccounts('tls')
    await applyPush(t.deps)
    expect(t.push.calls).toEqual(['unregisterAll'])
  })

  it('registers the inbox of every account when notifications are on', async () => {
    const t = await withAccounts('tls', 'starttls')
    await saveNotificationSettings(t.db, { enabled: true })
    await applyPush(t.deps)
    expect([...t.push.sources.keys()].sort()).toEqual(t.accounts.map((account) => account.id).sort())
  })

  it('takes a muted account out and an account that cannot be watched, and keeps the others in', async () => {
    const t = await withAccounts('tls', 'tls', 'none')
    await saveNotificationSettings(t.db, { enabled: true, mutedAccountIds: [t.accounts[1].id] })
    await applyPush(t.deps)
    expect([...t.push.sources.keys()]).toEqual([t.accounts[0].id])
    expect(t.push.calls).toContain(`unregister ${t.accounts[1].id}`)
    expect(t.push.calls).toContain(`unregister ${t.accounts[2].id}`)
  })

  it('may be run again, and tells the service the same things', async () => {
    const t = await withAccounts('tls')
    await saveNotificationSettings(t.db, { enabled: true })
    await applyPush(t.deps)
    await applyPush(t.deps)
    expect(t.push.calls).toEqual([`register ${t.accounts[0].id}`, `register ${t.accounts[0].id}`])
    expect(t.push.sources.size).toBe(1)
  })

  it('says it when the service cannot be told, and raises nothing', async () => {
    const t = await withAccounts('tls')
    await saveNotificationSettings(t.db, { enabled: true })
    t.push.failWith = new Error('no receiver')
    await expect(applyPush(t.deps)).resolves.toBeUndefined()
    expect(t.errors[0]).toContain('no receiver')
  })
})

describe('taking an account out of the push service', () => {
  it('unregisters it', async () => {
    const t = await withAccounts('tls')
    await forgetPush(t.deps, t.accounts[0].id)
    expect(t.push.calls).toEqual([`unregister ${t.accounts[0].id}`])
  })

  it('does nothing without a service, and says it when the service does not answer', async () => {
    const t = await withAccounts('tls')
    t.push.present = false
    await forgetPush(t.deps, t.accounts[0].id)
    expect(t.push.calls).toEqual([])
    t.push.present = true
    t.push.failWith = new Error('gone')
    await expect(forgetPush(t.deps, t.accounts[0].id)).resolves.toBeUndefined()
    expect(t.errors[0]).toContain('gone')
  })
})
