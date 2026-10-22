import { describe, expect, it } from 'vitest'
import type { ImapSession } from '@peregrine/core/imapSession'
import type { Account } from './accounts'
import { Connections } from './connections'

const account = (id: string): Account => ({
  id,
  displayName: id,
  emailAddress: `${id}@example.org`,
  imapHost: 'imap.example.org',
  imapPort: 993,
  imapSecure: 'tls',
  imapUsername: id,
  smtpHost: null,
  smtpPort: null,
  smtpSecure: null,
  smtpUsername: null,
  password: 'secret',
  smtpPassword: null,
  color: '#2f5d9f',
  createdAt: 0
})

interface FakeSession extends ImapSession {
  ended: () => void
  disconnected: number
}

function fakeSession(): FakeSession {
  let listener: () => void = () => undefined
  const session = {
    disconnected: 0,
    onClose: (l: () => void) => void (listener = l),
    disconnect: async () => void session.disconnected++,
    ended: () => listener()
  }
  return session as unknown as FakeSession
}

function setup(options: { fail?: () => boolean } = {}) {
  const made: FakeSession[] = []
  const changes = { count: 0 }
  let release: (() => void) | null = null
  const hold = { on: false }
  const connections = new Connections(
    async () => {
      if (hold.on) await new Promise<void>((resolve) => (release = resolve))
      if (options.fail?.()) throw new Error('connection refused')
      const session = fakeSession()
      made.push(session)
      return session
    },
    () => void changes.count++
  )
  return { connections, made, changes, hold, release: () => release?.() }
}

describe('the connections of the accounts', () => {
  it('connects an account once, and hands the same connection to whoever asks next', async () => {
    const t = setup()
    const first = await t.connections.ensure(account('a'))
    expect(await t.connections.ensure(account('a'))).toBe(first)
    expect(t.connections.get('a')).toBe(first)
    expect(t.made).toHaveLength(1)
    expect(t.connections.get('b')).toBeNull()
  })

  it('makes one connection when two screens ask while it is being made', async () => {
    const t = setup()
    t.hold.on = true
    const one = t.connections.ensure(account('a'))
    const two = t.connections.ensure(account('a'))
    t.release()
    expect(await one).toBe(await two)
    expect(t.made).toHaveLength(1)
  })

  it('keeps the accounts apart', async () => {
    const t = setup()
    const a = await t.connections.ensure(account('a'))
    const b = await t.connections.ensure(account('b'))
    expect(a).not.toBe(b)
    expect(t.connections.connectedIds.sort()).toEqual(['a', 'b'])
  })

  it('does not remember a connection that failed, and tries again the next time', async () => {
    let failing = true
    const t = setup({ fail: () => failing })
    await expect(t.connections.ensure(account('a'))).rejects.toThrow('connection refused')
    expect(t.connections.get('a')).toBeNull()
    failing = false
    await expect(t.connections.ensure(account('a'))).resolves.toBeTruthy()
  })

  it('forgets a connection that ended, says so, and connects again when asked', async () => {
    const t = setup()
    const first = (await t.connections.ensure(account('a'))) as FakeSession
    const before = t.changes.count
    first.ended()
    expect(t.connections.get('a')).toBeNull()
    expect(t.changes.count).toBe(before + 1)
    expect(await t.connections.ensure(account('a'))).not.toBe(first)
  })

  it('is not fooled by the end of a connection that was let go and replaced', async () => {
    const t = setup()
    const old = (await t.connections.ensure(account('a'))) as FakeSession
    t.connections.drop('a')
    const fresh = await t.connections.ensure(account('a'))
    old.ended()
    expect(t.connections.get('a')).toBe(fresh)
  })

  it('takes a connection that was made elsewhere, and lets go of the one it replaces', async () => {
    const t = setup()
    const old = (await t.connections.ensure(account('a'))) as FakeSession
    const own = fakeSession()
    t.connections.adopt('a', own)
    expect(t.connections.get('a')).toBe(own)
    expect(old.disconnected).toBe(1)
    // the replaced one ending is not the end of the account's connection
    old.ended()
    expect(t.connections.get('a')).toBe(own)
    await expect(t.connections.ensure(account('a'))).resolves.toBe(own)
    expect(t.made).toHaveLength(1)
  })

  it('lets go of one or of all', async () => {
    const t = setup()
    const a = (await t.connections.ensure(account('a'))) as FakeSession
    const b = (await t.connections.ensure(account('b'))) as FakeSession
    t.connections.drop('a')
    expect(a.disconnected).toBe(1)
    expect(t.connections.connectedIds).toEqual(['b'])
    t.connections.drop('nobody')
    t.connections.dropAll()
    expect(b.disconnected).toBe(1)
    expect(t.connections.connectedIds).toEqual([])
  })
})
