import { describe, expect, it } from 'vitest'
import type { ComposeInput } from '@peregrine/core/types'
import { FakeSmtpServer } from '../../../packages/smtp/test-support/fakeServer'
import { addAccount, getAccount, type NewAccount } from './accounts'
import type { ImapSession, MailboxEntry } from '@peregrine/core/imapSession'
import { syncFolders } from './folders'
import { MAX_ATTACHMENT_BYTES, type FileAccess } from './files'
import { sendAndFile, sendMessage, smtpSettingsOf } from './send'
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
    const { result } = await sendMessage(t.db, { makeTransport: t.make }, input(t.account.id))

    expect(result.accepted.sort()).toEqual(['anna@example.net', 'hidden@example.net'])
    expect(t.server.received.map((line) => line.split(' ')[0])).toEqual(['EHLO', 'STARTTLS', 'EHLO', 'AUTH', 'MAIL', 'RCPT', 'RCPT', 'DATA', 'QUIT'])
    expect(t.server.received.find((line) => line.startsWith('MAIL'))).toContain('alex@example.org')
    expect(t.server.closed).toBe(true)
  })

  it('writes the sender from the account, and keeps the blind copy out of the headers', async () => {
    const t = await setup()
    await sendMessage(t.db, { makeTransport: t.make }, input(t.account.id), { random: () => 0.5 })
    const source = text(t.server.messages[0])
    expect(source).toMatch(/^From: Alex <alex@example\.org>\r$/m)
    expect(source).toMatch(/^To: Anna <anna@example\.net>\r$/m)
    expect(source).not.toContain('hidden@example.net')
    expect(source).toMatch(/^Subject: =\?UTF-8\?/m)
  })

  it('does not write a name that is only the address again', async () => {
    const t = await setup({ displayName: 'alex@example.org' })
    await sendMessage(t.db, { makeTransport: t.make }, input(t.account.id))
    expect(text(t.server.messages[0])).toMatch(/^From: alex@example\.org\r$/m)
  })

  it('sends the html part when there is one, and the thread it belongs to', async () => {
    const t = await setup()
    await sendMessage(
      t.db,
      { makeTransport: t.make },
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
    await expect(sendMessage(t.db, { makeTransport: t.make }, input(t.account.id))).rejects.toThrow(/no such user|550/)
    expect(t.server.closed).toBe(true)
  })

  it('refuses what the phone cannot do, and sends nothing: a message for later, one to be encrypted or signed without a key', async () => {
    const t = await setup()
    const refused = async (over: Partial<ComposeInput>, reason: RegExp) => {
      await expect(sendMessage(t.db, { makeTransport: t.make }, input(t.account.id, over))).rejects.toThrow(reason)
    }
    await refused({ encrypt: true }, /keinen Schlüssel/)
    await refused({ sign: true }, /keinen Schlüssel/)
    await refused({ sendAt: Date.now() + 3600_000 }, /later time/)
    expect(t.server.connectedWith).toBeNull()
  })

  it('sends a message whose time has come, as the queue hands it over', async () => {
    const t = await setup()
    await sendMessage(t.db, { makeTransport: t.make }, input(t.account.id, { sendAt: Date.now() - 1000, sendNow: true }))
    expect(t.server.messages).toHaveLength(1)
  })

  it('says what is wrong with the account instead of failing in some other way', async () => {
    const noAddress = await setup({ emailAddress: '' })
    await expect(sendMessage(noAddress.db, { makeTransport: noAddress.make }, input(noAddress.account.id))).rejects.toThrow(/no address/)
    const noServer = await setup({ smtpHost: null })
    await expect(sendMessage(noServer.db, { makeTransport: noServer.make }, input(noServer.account.id))).rejects.toThrow(/no server for sending/)
    const gone = await setup()
    await expect(sendMessage(gone.db, { makeTransport: gone.make }, input('nobody'))).rejects.toThrow(/is gone/)
  })
})

describe('filing a copy in Sent', () => {
  const entry = (path: string, specialUse: string | null): MailboxEntry => ({ path, name: path, parentPath: null, flags: [], specialUse })

  async function filing(withSent: boolean) {
    const t = await setup()
    await syncFolders(t.db, t.account.id, [entry('INBOX', null), ...(withSent ? [entry('Gesendet', '\\Sent')] : [])])
    const appended: { path: string; source: string; flags: string[] }[] = []
    const failure = { error: null as Error | null }
    const imap = {
      appendMessage: async (path: string, source: Uint8Array | string, flags: string[]) => {
        if (failure.error) throw failure.error
        appended.push({ path, source: typeof source === 'string' ? source : text(source), flags })
        return 7
      }
    } as unknown as ImapSession
    const logs: string[] = []
    return { ...t, imap, appended, failure, logs, log: { error: (m: string) => logs.push(m) } }
  }

  it('files what went out, marked read, in the folder the server calls Sent', async () => {
    const t = await filing(true)
    await sendAndFile(t.db, { makeTransport: t.make }, input(t.account.id), t.imap, t.log)
    expect(t.appended).toHaveLength(1)
    expect(t.appended[0]).toMatchObject({ path: 'Gesendet', flags: ['\\Seen'] })
    // the same bytes the server was given, and like them without the blind copy
    expect(t.appended[0].source).toContain('Subject:')
    expect(t.appended[0].source).not.toContain('hidden@example.net')
  })

  it('files nothing for an account with no Sent folder, and sends all the same', async () => {
    const t = await filing(false)
    await sendAndFile(t.db, { makeTransport: t.make }, input(t.account.id), t.imap, t.log)
    expect(t.appended).toEqual([])
    expect(t.server.messages).toHaveLength(1)
  })

  // Failing here would send the message again on the next run, for the sake of a copy.
  it('does not fail the send when the copy could not be made, and says so', async () => {
    const t = await filing(true)
    t.failure.error = new Error('NO [OVERQUOTA] mailbox is full')
    const sent = await sendAndFile(t.db, { makeTransport: t.make }, input(t.account.id), t.imap, t.log)
    expect(sent.result.accepted).toHaveLength(2)
    expect(t.logs).toEqual([expect.stringContaining('OVERQUOTA')])
  })

  it('files nothing when the sending failed', async () => {
    const t = await filing(true)
    t.server.on('RCPT', () => '550 no such user\r\n')
    await expect(sendAndFile(t.db, { makeTransport: t.make }, input(t.account.id), t.imap, t.log)).rejects.toThrow()
    expect(t.appended).toEqual([])
  })
})

describe('sending attachments', () => {
  /** Files by path, as the copies of what was picked. */
  function store(content: Record<string, Uint8Array>) {
    const removed: string[] = []
    const files: FileAccess = {
      read: async (path) => {
        const found = content[path]
        if (!found) throw new Error(`No such file: ${path}`)
        return found
      },
      remove: async (paths) => void removed.push(...paths)
    }
    return { files, removed }
  }
  const ascii = (value: string): Uint8Array => Uint8Array.from(value, (c) => c.charCodeAt(0))

  async function withFiles(content: Record<string, Uint8Array>, over: Partial<NewAccount> = {}) {
    const t = await setup(over)
    const made = store(content)
    return { ...t, ...made, environment: { makeTransport: t.make, files: made.files } }
  }

  it('sends the files with their names and types, and the server takes the message whole', async () => {
    const t = await withFiles({ '/store/report.pdf': ascii('%PDF-1.7 report'), '/store/notes.txt': ascii('some notes') })
    await sendMessage(
      t.db,
      t.environment,
      input(t.account.id, {
        attachments: [
          { filename: 'report.pdf', path: '/store/report.pdf', contentType: 'application/pdf' },
          { filename: 'notes.txt', path: '/store/notes.txt' }
        ]
      })
    )
    const source = text(t.server.messages[0])
    expect(source).toContain('multipart/mixed')
    // the header is folded after the semicolon
    expect(source).toMatch(/Content-Type: application\/pdf;\s+name="report\.pdf"/)
    // the type of the second is worked out from its name
    expect(source).toMatch(/Content-Type: text\/plain;\s+name="notes\.txt"/)
    expect(source).toContain(Buffer.from('%PDF-1.7 report').toString('base64'))
  })

  it('writes a name that came from the picker as a safe one', async () => {
    const t = await withFiles({ '/store/x': ascii('x') })
    await sendMessage(t.db, t.environment, input(t.account.id, { attachments: [{ filename: '../../evil.sh', path: '/store/x' }] }))
    expect(text(t.server.messages[0])).toContain('name="_.._evil.sh"')
  })

  it('refuses a message with attachments when it cannot read files, and sends nothing', async () => {
    const t = await setup()
    await expect(
      sendMessage(t.db, { makeTransport: t.make }, input(t.account.id, { attachments: [{ filename: 'a.txt', path: '/store/a.txt' }] }))
    ).rejects.toThrow(/cannot read the files/)
    expect(t.server.connectedWith).toBeNull()
  })

  it('fails with the reason when a copy is gone, and sends nothing', async () => {
    const t = await withFiles({})
    await expect(
      sendMessage(t.db, t.environment, input(t.account.id, { attachments: [{ filename: 'a.txt', path: '/store/gone' }] }))
    ).rejects.toThrow('No such file: /store/gone')
    expect(t.server.connectedWith).toBeNull()
  })

  it('refuses attachments that together are more than a message may carry', async () => {
    const big = new Uint8Array(MAX_ATTACHMENT_BYTES / 2 + 1)
    const t = await withFiles({ '/store/a': big, '/store/b': big })
    await expect(
      sendMessage(
        t.db,
        t.environment,
        input(t.account.id, {
          attachments: [
            { filename: 'a.bin', path: '/store/a' },
            { filename: 'b.bin', path: '/store/b' }
          ]
        })
      )
    ).rejects.toThrow(/larger than one message/)
    expect(t.server.connectedWith).toBeNull()
  })

  describe('and the copies of the files', () => {
    const attached = [{ filename: 'a.txt', path: '/store/a' }]

    async function filing(content: Record<string, Uint8Array>) {
      const t = await withFiles(content)
      const imap = { appendMessage: async () => 1 } as unknown as ImapSession
      const logs: string[] = []
      return { ...t, imap, logs, log: { error: (m: string) => logs.push(m) } }
    }

    it('are removed once the message has gone out', async () => {
      const t = await filing({ '/store/a': ascii('a') })
      await sendAndFile(t.db, t.environment, input(t.account.id, { attachments: attached }), t.imap, t.log)
      expect(t.removed).toEqual(['/store/a'])
    })

    // The queue sends the message again, and needs them.
    it('stay when the sending failed', async () => {
      const t = await filing({ '/store/a': ascii('a') })
      t.server.on('RCPT', () => '550 no such user' + String.fromCharCode(13, 10))
      await expect(sendAndFile(t.db, t.environment, input(t.account.id, { attachments: attached }), t.imap, t.log)).rejects.toThrow()
      expect(t.removed).toEqual([])
    })

    it('do not fail the send when they cannot be removed, and it is said', async () => {
      const t = await filing({ '/store/a': ascii('a') })
      t.environment.files.remove = async () => {
        throw new Error('disk error')
      }
      const sent = await sendAndFile(t.db, t.environment, input(t.account.id, { attachments: attached }), t.imap, t.log)
      expect(sent.result.accepted).toHaveLength(2)
      expect(t.logs).toEqual([expect.stringContaining('disk error')])
    })
  })
})
