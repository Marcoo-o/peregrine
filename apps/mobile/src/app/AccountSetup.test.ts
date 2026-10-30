import { describe, expect, it } from 'vitest'
import { getAccount, listAccounts } from '../accounts'
import { saveNotificationSettings } from '../settings'
import { appHarness } from '../testing/appHarness'
import { editFieldsOf, type AccountForm, type EditFields } from './accountForm'

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
  // The server for sending takes this login, as the one for reading does.
  t.smtp.credentials = { user: 'work', pass: 'secret' }
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

describe('the login for sending', () => {
  it('is tried before an account is kept, and a wrong one keeps nothing, says so, and lets go of the connection for reading', async () => {
    const t = await withServer()
    await t.app.accounts.signIn(form({ password: 'secret' }))
    const kept = (await listAccounts(t.db)).length
    expect(kept).toBe(1)

    const other = await withServer()
    other.smtp.credentials = { user: 'someone else', pass: 'other' }
    await other.app.accounts.signIn(form())
    expect(await listAccounts(other.db)).toEqual([])
    expect(other.store.screen).toMatchObject({ name: 'login', error: expect.stringMatching(/^Zum Senden: /) })
    expect(other.app.accounts.lastAttempt).toEqual(form())
    expect(other.app.services.connections.connectedIds).toEqual([])
  })

  it('is not tried for an account that only reads', async () => {
    const t = await withServer()
    t.smtp.credentials = { user: 'nobody', pass: 'nothing' }
    await t.app.accounts.signIn(form({ smtpHost: '' }))
    expect(await listAccounts(t.db)).toHaveLength(1)
  })
})

describe('finding the servers of an address', () => {
  it('is for the screen to ask, and gives what the finder gives', async () => {
    const t = await appHarness()
    t.app.accounts.find = async (email) => ({
      source: 'provider',
      imap: { host: 'imap.example.net', port: 993, secure: 'tls', username: email },
      smtp: { host: 'smtp.example.net', port: 587, secure: 'starttls' },
      oauth2: false
    })
    expect(await t.app.accounts.find('sam@example.net')).toMatchObject({ imap: { host: 'imap.example.net' } })
  })
})

describe('changing an account', () => {
  async function signedIn() {
    const t = await withServer()
    await t.app.accounts.signIn(form())
    const [account] = await listAccounts(t.db)
    t.server.sessions.length = 0
    return { ...t, account }
  }

  const edit = (account: Awaited<ReturnType<typeof signedIn>>['account'], over: Partial<EditFields> = {}): EditFields => ({
    ...editFieldsOf(account),
    ...over
  })

  it('is a screen of its own, with the account', async () => {
    const t = await signedIn()
    t.app.accounts.startEdit(t.account)
    expect(t.store.screen).toEqual({ name: 'editAccount', account: t.account })
  })

  it('keeps a new name and colour without trying any connection, and shows the folders', async () => {
    const t = await signedIn()
    await t.app.accounts.save(t.account, edit(t.account, { displayName: 'Work mail', color: '#b03a5b' }))
    const saved = await getAccount(t.db, t.account.id)
    expect(saved).toMatchObject({ displayName: 'Work mail', color: '#b03a5b', imapHost: 'imap.example.org' })
    expect(t.server.sessions).toHaveLength(0)
    expect(t.store.screen).toMatchObject({ name: 'folders', account: { displayName: 'Work mail' } })
  })

  it('tries a new password for reading before it keeps it, and makes the connection that proved it the account’s', async () => {
    const t = await signedIn()
    t.smtp.credentials = { user: 'work', pass: 'new secret' }
    await t.app.accounts.save(t.account, edit(t.account, { password: 'new secret' }))
    expect((await getAccount(t.db, t.account.id))?.password).toBe('new secret')
    expect(t.server.sessions).toHaveLength(1)
    expect(t.app.services.connections.get(t.account.id)).toBe(t.server.sessions[0])
  })

  it('keeps nothing when the new login for reading does not work, says so, and keeps the form', async () => {
    const t = await signedIn()
    t.server.unreachable.add('work')
    await t.app.accounts.save(t.account, edit(t.account, { host: 'elsewhere.example.org' }))
    expect((await getAccount(t.db, t.account.id))?.imapHost).toBe('imap.example.org')
    expect(t.store.screen).toMatchObject({ name: 'editAccount', error: expect.stringMatching(/^Zum Lesen: /) })
  })

  it('keeps nothing when the new login for sending does not work, and lets go of the connection that was made for reading', async () => {
    const t = await signedIn()
    t.smtp.credentials = { user: 'someone else', pass: 'other' }
    await t.app.accounts.save(t.account, edit(t.account, { smtpHost: 'smtp.other.example.org' }))
    expect((await getAccount(t.db, t.account.id))?.smtpHost).toBe('smtp.example.org')
    expect(t.store.screen).toMatchObject({ name: 'editAccount', error: expect.stringMatching(/^Zum Senden: /) })
  })

  it('takes a separate login for sending, tried against the server for sending only', async () => {
    const t = await signedIn()
    t.smtp.credentials = { user: 'sender', pass: 'send secret' }
    await t.app.accounts.save(t.account, edit(t.account, { smtpUsername: 'sender', smtpPassword: 'send secret' }))
    expect(await getAccount(t.db, t.account.id)).toMatchObject({ smtpUsername: 'sender', smtpPassword: 'send secret' })
    expect(t.server.sessions).toHaveLength(0)
  })

  it('makes an account that only reads of one whose server for sending is taken away, without trying anything', async () => {
    const t = await signedIn()
    t.smtp.credentials = { user: 'nobody', pass: 'nothing' }
    await t.app.accounts.save(t.account, edit(t.account, { smtpHost: '' }))
    expect(await getAccount(t.db, t.account.id)).toMatchObject({ smtpHost: null, smtpPort: null, smtpUsername: null, smtpPassword: null })
  })

  it('is shown busy while the connection is tried', async () => {
    const t = await signedIn()
    const busy: Array<boolean | undefined> = []
    t.store.subscribe(() => {
      if (t.store.screen.name === 'editAccount') busy.push(t.store.screen.busy)
    })
    await t.app.accounts.save(t.account, edit(t.account, { displayName: 'x' }))
    expect(busy[0]).toBe(true)
  })
})
