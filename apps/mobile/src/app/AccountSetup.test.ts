import { describe, expect, it } from 'vitest'
import { getAccount, listAccounts } from '../accounts'
import { saveNotificationSettings } from '../settings'
import { appHarness } from '../testing/appHarness'
import type { AccountForm } from './accountForm'

const form = (over: Partial<AccountForm> = {}): AccountForm => ({
  email: 'work@example.org',
  host: 'imap.example.org',
  port: 993,
  secure: 'tls',
  username: 'work',
  password: 'secret',
  smtpHost: 'smtp.example.org',
  smtpPort: 587,
  smtpSecure: 'starttls',
  ...over
})

async function withServer() {
  const t = await appHarness()
  t.server.addUser('work', { INBOX: [{ uid: 1 }], Trash: [] })
  return t
}

describe('signing in', () => {
  it('keeps the account that connected, with the connection that proved the login, and shows its folders', async () => {
    const t = await withServer()
    await t.app.accounts.signIn(form())

    const [account] = await listAccounts(t.db)
    expect(account).toMatchObject({ emailAddress: 'work@example.org', imapUsername: 'work', smtpHost: 'smtp.example.org' })
    expect(t.store.screen).toMatchObject({ name: 'folders', account: { id: account.id } })
    // one connection was made, and it is the account's
    expect(t.server.sessions).toHaveLength(1)
    expect(t.app.services.connections.get(account.id)).toBe(t.server.sessions[0])
    expect(t.store.state.connected).toEqual([account.id])
  })

  it('keeps no account when the connection fails, shows the form with the reason and remembers what was typed', async () => {
    const t = await withServer()
    t.server.unreachable.add('work')
    const typed = form({ password: 'wrong guess' })

    await t.app.accounts.signIn(typed)

    expect(await listAccounts(t.db)).toEqual([])
    expect(t.store.screen).toEqual({ name: 'login', error: 'Der Server ist nicht erreichbar. (work: connection refused)' })
    expect(t.app.accounts.lastAttempt).toBe(typed)
  })

  it('shows the loading screen while it connects', async () => {
    const t = await withServer()
    const names: string[] = []
    t.store.subscribe(() => names.push(t.store.screen.name))
    await t.app.accounts.signIn(form())
    expect(names[0]).toBe('loading')
  })

  it('makes an account that only reads when no server for sending was given', async () => {
    const t = await withServer()
    await t.app.accounts.signIn(form({ smtpHost: '  ' }))
    const [account] = await listAccounts(t.db)
    expect(account).toMatchObject({ smtpHost: null, smtpPort: null, smtpSecure: null })
  })
})

describe('removing an account', () => {
  it('lets go of its connection, deletes it and shows the form when it was the last', async () => {
    const t = await withServer()
    await t.app.accounts.signIn(form())
    const [account] = await listAccounts(t.db)

    await t.app.accounts.remove(account)

    expect(await getAccount(t.db, account.id)).toBeUndefined()
    expect(t.server.calls).toContain('disconnect work')
    expect(t.app.services.connections.get(account.id)).toBeNull()
    expect(t.store.screen.name).toBe('login')
  })

  it('shows the list of accounts that are left', async () => {
    const t = await withServer()
    const home = await t.givenAccount('home', { INBOX: [] })
    await t.app.accounts.signIn(form())
    const work = (await listAccounts(t.db)).find((a) => a.imapUsername === 'work')!

    await t.app.accounts.remove(work)

    expect(t.store.screen).toMatchObject({ name: 'accounts', accounts: [{ id: home.id }] })
  })
})

describe('the push service and the accounts', () => {
  it('is told of an account that is signed in, when notifications are on', async () => {
    const t = await withServer()
    await saveNotificationSettings(t.db, { enabled: true })
    await t.app.accounts.signIn(form())
    const [account] = await listAccounts(t.db)
    expect([...t.push.sources.keys()]).toEqual([account.id])
    expect(t.push.sources.get(account.id)).toMatchObject({ host: 'imap.example.org', username: 'work', password: 'secret', mailbox: 'INBOX' })
  })

  it('is told nothing of an account that is signed in while notifications are off', async () => {
    const t = await withServer()
    await t.app.accounts.signIn(form())
    expect(t.push.sources.size).toBe(0)
  })

  it('loses an account that is removed', async () => {
    const t = await withServer()
    await saveNotificationSettings(t.db, { enabled: true })
    await t.app.accounts.signIn(form())
    const [account] = await listAccounts(t.db)
    await t.app.accounts.remove(account)
    expect(t.push.sources.size).toBe(0)
    expect(t.push.calls).toContain(`unregister ${account.id}`)
  })
})
