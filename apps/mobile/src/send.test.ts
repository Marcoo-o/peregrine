import { describe, expect, it } from 'vitest'
import type { ComposeInput } from '@peregrine/core/types'
import { FakeSmtpServer } from '../../../packages/smtp/test-support/fakeServer'
import { addAccount, getAccount, type NewAccount } from './accounts'
import { sendMessage, smtpSettingsOf } from './send'
import { migratedDatabase } from './testing/testDb'

const newAccount = (over: Partial<NewAccount> = {}): NewAccount => ({
  displayName: 'Alex',
  emailAddress: 'alex@example.org',
  imapHost: 'imap.example.org',
  imapPort: 993,
  imapSecure: 'tls',
  imapUsername: 'user',
  smtpHost: 'smtp.example.org',
  smtpPort: null,
  smtpSecure: null,
  smtpUsername: null,
  password: 'pass',
  smtpPassword: null,
  ...over
})

const input = (accountId: string, over: Partial<ComposeInput> = {}): ComposeInput => ({
  accountId,
  to: [{ name: 'Anna', address: 'anna@example.net' }],
  cc: [],
  bcc: [{ name: '', address: 'hidden@example.net' }],
  subject: 'Grüße',
  textBody: 'Hello\nWorld',
  htmlBody: '',
  attachments: [],
  ...over
})

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

async function setup(over: Partial<NewAccount> = {}) {
  const { db } = await migratedDatabase()
  const account = await addAccount(db, newAccount(over))
  const server = new FakeSmtpServer()
  return { db, account, server, make: () => server.transport }
}

describe('the settings for sending', () => {
  it('are the ones given, and for what was left out the usual: the same login, the port of the kind of connection', async () => {
    const { db, account } = await setup()
    const stored = (await getAccount(db, account.id)) as NonNullable<Awaited<ReturnType<typeof getAccount>>>
    expect(smtpSettingsOf(stored)).toEqual({ host: 'smtp.example.org', port: 587, secure: 'starttls', username: 'user', password: 'pass' })
    expect(smtpSettingsOf({ ...stored, smtpSecure: 'tls' })?.port).toBe(465)
    expect(smtpSettingsOf({ ...stored, smtpPort: 2525, smtpUsername: 'sender', smtpPassword: 'other' })).toMatchObject({
      port: 2525,
      username: 'sender',
      password: 'other'
    })
  })

  it('do not exist for an account without a server for sending', async () => {
    const { db, account } = await setup({ smtpHost: null })
    expect(smtpSettingsOf((await getAccount(db, account.id)) as never)).toBeUndefined()
  })
})

describe('sending from the application', () => {
  it('logs in, sends the message to everybody, bcc included, and says goodbye', async () => {
    const t = await setup()
    const result = await sendMessage(t.db, t.make, input(t.account.id))

    expect(result.accepted.sort()).toEqual(['anna@example.net', 'hidden@example.net'])
    expect(t.server.received.map((line) => line.split(' ')[0])).toEqual(['EHLO', 'STARTTLS', 'EHLO', 'AUTH', 'MAIL', 'RCPT', 'RCPT', 'DATA', 'QUIT'])
    expect(t.server.received.find((line) => line.startsWith('MAIL'))).toContain('alex@example.org')
    expect(t.server.closed).toBe(true)
  })

  it('writes the sender from the account, and keeps the blind copy out of the headers', async () => {
    const t = await setup()
    await sendMessage(t.db, t.make, input(t.account.id), { random: () => 0.5 })
    const source = text(t.server.messages[0])
    expect(source).toMatch(/^From: Alex <alex@example\.org>\r$/m)
    expect(source).toMatch(/^To: Anna <anna@example\.net>\r$/m)
    expect(source).not.toContain('hidden@example.net')
    expect(source).toMatch(/^Subject: =\?UTF-8\?/m)
  })

  it('does not write a name that is only the address again', async () => {
    const t = await setup({ displayName: 'alex@example.org' })
    await sendMessage(t.db, t.make, input(t.account.id))
    expect(text(t.server.messages[0])).toMatch(/^From: alex@example\.org\r$/m)
  })

  it('sends the html part when there is one, and the thread it belongs to', async () => {
    const t = await setup()
    await sendMessage(
      t.db,
      t.make,
      input(t.account.id, { htmlBody: '<p>Hello</p>', inReplyTo: '<one@example.net>', references: '<zero@example.net> <one@example.net>' })
    )
    const source = text(t.server.messages[0])
    expect(source).toContain('multipart/alternative')
    expect(source).toMatch(/^In-Reply-To: <one@example\.net>\r$/m)
    expect(source).toContain('<zero@example.net>')
  })

  it('closes the connection when the server refuses, and says why', async () => {
    const t = await setup()
    t.server.on('RCPT', () => '550 no such user\r\n')
    await expect(sendMessage(t.db, t.make, input(t.account.id))).rejects.toThrow(/no such user|550/)
    expect(t.server.closed).toBe(true)
  })

  it('refuses what the phone cannot do yet, and sends nothing', async () => {
    const t = await setup()
    const refused = async (over: Partial<ComposeInput>, reason: RegExp) => {
      await expect(sendMessage(t.db, t.make, input(t.account.id, over))).rejects.toThrow(reason)
    }
    await refused({ attachments: [{ filename: 'a.txt', path: '/x' }] }, /Attachments/)
    await refused({ encrypt: true }, /Encrypting/)
    await refused({ sign: true }, /signing/)
    await refused({ sendAt: Date.now() + 3600_000 }, /later time/)
    expect(t.server.connectedWith).toBeNull()
  })

  it('sends a message whose time has come, as the queue hands it over', async () => {
    const t = await setup()
    await sendMessage(t.db, t.make, input(t.account.id, { sendAt: Date.now() - 1000, sendNow: true }))
    expect(t.server.messages).toHaveLength(1)
  })

  it('says what is wrong with the account instead of failing in some other way', async () => {
    const noAddress = await setup({ emailAddress: '' })
    await expect(sendMessage(noAddress.db, noAddress.make, input(noAddress.account.id))).rejects.toThrow(/no address/)
    const noServer = await setup({ smtpHost: null })
    await expect(sendMessage(noServer.db, noServer.make, input(noServer.account.id))).rejects.toThrow(/no server for sending/)
    const gone = await setup()
    await expect(sendMessage(gone.db, gone.make, input('nobody'))).rejects.toThrow(/is gone/)
  })
})
