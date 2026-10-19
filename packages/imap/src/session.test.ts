import { afterEach, describe, expect, it } from 'vitest'
import type { ImapSessionOptions } from '@peregrine/core/imapSession'
import { FakeServer } from '../test-support/fakeServer'
import { ImapError } from './client'
import { ImapClientSession } from './session'
import { decodeUtf8 } from './utf8'

const CRLF = '\r\n'
const settle = (ms = 80): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const sessions: ImapClientSession[] = []

function open(
  server: FakeServer,
  options: Partial<ImapSessionOptions> = {},
  log?: (line: string) => void
): ImapClientSession {
  const session = new ImapClientSession(
    { host: 'mail.example.com', port: 993, secure: 'tls', username: 'test', password: 'test', ...options },
    {
      transport: server.transport,
      parkDelayMs: 25,
      inactivityTimeoutMs: 300,
      greetingTimeoutMs: 300,
      logoutTimeoutMs: 100,
      log: log ? (event) => log(`${event.direction}: ${event.text}`) : undefined
    }
  )
  sessions.push(session)
  return session
}

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.disconnect().catch(() => undefined)))
})

/** A server that accepts the login the way Dovecot did in the recording, and a few other things. */
function dovecot(server = new FakeServer()): FakeServer {
  server.on('AUTHENTICATE', (c) => server.replay('07-starttls', 'AUTHENTICATE', c.tag))
  server.on('LOGOUT', (c) => `* BYE Logging out${CRLF}${c.tag} OK Logout completed${CRLF}`)
  return server
}

function selectReply(tag: string, exists: number, validity = 1792357320, next = exists + 1): string {
  return (
    `* FLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft)${CRLF}` +
    `* OK [PERMANENTFLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft \\*)] Flags permitted.${CRLF}` +
    `* ${exists} EXISTS${CRLF}* 0 RECENT${CRLF}` +
    `* OK [UIDVALIDITY ${validity}] UIDs valid${CRLF}` +
    `* OK [UIDNEXT ${next}] Predicted next UID${CRLF}` +
    `${tag} OK [READ-WRITE] Select completed${CRLF}`
  )
}

async function connected(
  configure: (server: FakeServer) => void = () => undefined
): Promise<{ server: FakeServer; session: ImapClientSession }> {
  const server = dovecot()
  configure(server)
  const session = open(server)
  await session.connect()
  return { server, session }
}

describe('connecting', () => {
  it('logs in with AUTHENTICATE PLAIN and keeps the secret out of the log', async () => {
    const lines: string[] = []
    const server = dovecot()
    const session = open(server, {}, (line) => lines.push(line))

    await session.connect()

    expect(server.received[0]).toMatchObject({ verb: 'AUTHENTICATE', args: 'PLAIN AHRlc3QAdGVzdA==' })
    expect(server.connectedWith).toMatchObject({ host: 'mail.example.com', port: 993, tls: true })
    expect(lines.join('\n')).toContain('C: A1 AUTHENTICATE ***')
    expect(lines.join('\n')).not.toContain('AHRlc3QAdGVzdA')
  })

  it('learns what the server can do from the answer to the login', async () => {
    const { server } = await connected((s) => s.on('LIST', (c) => s.replay('03-mailboxes', 'LIST "" "*" RETURN', c.tag)))
    // MOVE and SPECIAL-USE are only in the list the server sends after logging in.
    expect(server.commands).toEqual(['AUTHENTICATE PLAIN AHRlc3QAdGVzdA=='])
  })

  it('asks for the capabilities when the answer to the login did not carry them', async () => {
    const server = new FakeServer('* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR] hi' + CRLF)
    server.on('AUTHENTICATE', (c) => FakeServer.ok(c.tag, 'Logged in'))
    server.on('CAPABILITY', (c) => `* CAPABILITY IMAP4rev1 IDLE MOVE${CRLF}${FakeServer.ok(c.tag)}`)
    await open(server).connect()
    expect(server.commands).toEqual(['AUTHENTICATE PLAIN AHRlc3QAdGVzdA==', 'CAPABILITY'])
  })

  it('asks for the capabilities when the greeting had none', async () => {
    const server = new FakeServer('* OK hello' + CRLF)
    server.on('CAPABILITY', (c) => `* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR${CRLF}${FakeServer.ok(c.tag)}`)
    server.on('AUTHENTICATE', (c) => `* CAPABILITY IMAP4rev1${CRLF}${FakeServer.ok(c.tag)}`)
    await open(server).connect()
    expect(server.commands[0]).toBe('CAPABILITY')
  })

  it('falls back to LOGIN, and sends a password with awkward characters as a literal', async () => {
    const server = new FakeServer('* OK [CAPABILITY IMAP4rev1 LITERAL+] hi' + CRLF)
    server.on('LOGIN', (c) => `* CAPABILITY IMAP4rev1${CRLF}${FakeServer.ok(c.tag)}`)
    await open(server, { password: 'pä ss"wörd' }).connect()

    const login = server.received[0]
    expect(login.args).toMatch(/^test <literal:\d+>$/)
    expect(decodeUtf8(login.literals[0])).toBe('pä ss"wörd')
  })

  it('waits for the server before sending a literal when it cannot do without', async () => {
    const server = new FakeServer('* OK [CAPABILITY IMAP4rev1] hi' + CRLF)
    server.on('LOGIN', (c) => `* CAPABILITY IMAP4rev1${CRLF}${FakeServer.ok(c.tag)}`)
    await open(server, { password: 'pässword' }).connect()
    expect(decodeUtf8(server.received[0].literals[0])).toBe('pässword')
  })

  it('quotes a password with a space and leaves a plain one bare', async () => {
    const server = new FakeServer('* OK [CAPABILITY IMAP4rev1] hi' + CRLF)
    server.on('LOGIN', (c) => `* CAPABILITY IMAP4rev1${CRLF}${FakeServer.ok(c.tag)}`)
    await open(server, { password: 'two words' }).connect()
    expect(server.received[0].args).toBe('test "two words"')
  })

  it('reports a refused login with the server\'s own words', async () => {
    const server = new FakeServer()
    server.on('AUTHENTICATE', (c) => `${c.tag} NO [AUTHENTICATIONFAILED] Authentication failed.${CRLF}`)
    const error = await open(server).connect().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ImapError)
    expect((error as ImapError).text).toBe('Authentication failed.')
    expect((error as ImapError).code?.name).toBe('AUTHENTICATIONFAILED')
  })

  it('refuses to log in when the server offers no way that is allowed', async () => {
    const server = new FakeServer('* OK [CAPABILITY IMAP4rev1 LOGINDISABLED STARTTLS] hi' + CRLF)
    await expect(open(server, { secure: 'none' }).connect()).rejects.toThrow()
    expect(server.commands.some((c) => c.startsWith('LOGIN') || c.startsWith('AUTHENTICATE'))).toBe(false)
  })

  it('gives up on a server that does not greet', async () => {
    const server = new FakeServer('')
    await expect(open(server).connect()).rejects.toThrow(/did not greet/)
  })

  it('does not go on after a farewell in place of a greeting', async () => {
    const server = new FakeServer('* BYE Too many connections' + CRLF)
    await expect(open(server).connect()).rejects.toMatchObject({ status: 'BYE' })
  })
})

describe('STARTTLS', () => {
  const greeting = '* OK [CAPABILITY IMAP4rev1 STARTTLS AUTH=PLAIN SASL-IR] hi' + CRLF

  function withStartTls(server: FakeServer): FakeServer {
    server.on('STARTTLS', (c) => FakeServer.ok(c.tag, 'Begin TLS negotiation now.'))
    server.on('CAPABILITY', (c) => `* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR${CRLF}${FakeServer.ok(c.tag)}`)
    server.on('AUTHENTICATE', (c) => `* CAPABILITY IMAP4rev1 IDLE${CRLF}${FakeServer.ok(c.tag, 'Logged in')}`)
    return server
  }

  const sentSecret = (server: FakeServer): boolean =>
    server.commands.some((c) => c.startsWith('LOGIN') || c.startsWith('AUTHENTICATE'))

  it('upgrades before logging in, and asks again what the server can do', async () => {
    const server = withStartTls(new FakeServer(greeting))
    await open(server, { secure: 'starttls', port: 143 }).connect()

    expect(server.commands).toEqual(['STARTTLS', 'CAPABILITY', 'AUTHENTICATE PLAIN AHRlc3QAdGVzdA=='])
    expect(server.tlsStarted).toBe(true)
    expect(server.connectedWith).toMatchObject({ tls: false })
  })

  // The point of the setting. A user who picked STARTTLS gets it or gets nothing, never a login
  // in the clear because somebody on the path removed the word from a list the server sent.
  it('does not send the password when the server does not offer STARTTLS', async () => {
    const server = withStartTls(new FakeServer('* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR] hi' + CRLF))
    await expect(open(server, { secure: 'starttls' }).connect()).rejects.toThrow(/STARTTLS/)
    expect(sentSecret(server)).toBe(false)
  })

  it('does not send the password when the server refuses STARTTLS', async () => {
    const server = withStartTls(new FakeServer(greeting))
    server.on('STARTTLS', (c) => `${c.tag} NO TLS not available${CRLF}`)
    await expect(open(server, { secure: 'starttls' }).connect()).rejects.toThrow(/TLS not available/)
    expect(sentSecret(server)).toBe(false)
  })

  it('does not send the password when the handshake fails', async () => {
    const server = withStartTls(new FakeServer(greeting))
    server.tlsFails = true
    await expect(open(server, { secure: 'starttls' }).connect()).rejects.toThrow(/certificate/)
    expect(sentSecret(server)).toBe(false)
  })

  it('upgrades when encryption was declined but is on offer', async () => {
    const server = withStartTls(new FakeServer(greeting))
    await open(server, { secure: 'none' }).connect()
    expect(server.tlsStarted).toBe(true)
  })

  it('carries on in the clear when encryption was declined and the upgrade is refused', async () => {
    const server = withStartTls(new FakeServer(greeting))
    server.on('STARTTLS', (c) => `${c.tag} NO not now${CRLF}`)
    await open(server, { secure: 'none' }).connect()
    expect(server.tlsStarted).toBe(false)
    expect(sentSecret(server)).toBe(true)
  })

  it('does not try at all with implicit TLS', async () => {
    const server = withStartTls(new FakeServer(greeting))
    await open(server, { secure: 'tls' }).connect()
    expect(server.commands).not.toContain('STARTTLS')
  })
})

describe('what the server sent for each operation', () => {
  it('lists mailboxes, decoding names and finding their roles and parents', async () => {
    const { server, session } = await connected((s) =>
      s.on('LIST', (c) => s.replay('03-mailboxes', 'LIST "" "*" RETURN', c.tag))
    )

    const entries = await session.listMailboxes()

    expect(server.received.at(-1)?.args).toBe('"" "*" RETURN (SPECIAL-USE)')
    const byPath = new Map(entries.map((e) => [e.path, e]))
    expect(byPath.get('Drafts')).toMatchObject({ name: 'Drafts', parentPath: null, specialUse: '\\Drafts' })
    expect(byPath.get('Archive')).toMatchObject({ specialUse: '\\Archive' })
    expect(byPath.get('Archive.2026')).toMatchObject({ name: '2026', parentPath: 'Archive', specialUse: null })
    expect(byPath.get('INBOX')).toMatchObject({ specialUse: '\\Inbox', parentPath: null })
    expect(byPath.has('Entwürfe')).toBe(true)
    expect(byPath.has('Projekte & Pläne')).toBe(true)
    expect(entries).toHaveLength(9)
  })

  it('finds the hierarchy delimiter', async () => {
    const { session } = await connected((s) =>
      s.on('LIST', (c) => s.replay('03-mailboxes', 'LIST "" ""', c.tag))
    )
    expect(await session.pathDelimiter()).toBe('.')
  })

  it('asks for the state of a mailbox it has not opened', async () => {
    const { server, session } = await connected((s) =>
      s.on('STATUS', (c) => s.replay('03-mailboxes', 'STATUS "Archive.2026"', c.tag))
    )

    expect(await session.mailboxStatus('Archive.2026')).toEqual({
      uidValidity: 1792357322n,
      uidNext: 1,
      messages: 0
    })
    expect(server.received.at(-1)?.args).toBe('"Archive.2026" (UIDNEXT UIDVALIDITY MESSAGES)')
  })

  it('does not ask STATUS about the mailbox that is already open', async () => {
    const { server, session } = await connected((s) => {
      s.on('SELECT', (c) => s.replay('02-fetch', 'SELECT INBOX', c.tag))
      s.on('UID FETCH', (c) => FakeServer.ok(c.tag))
      s.on('NOOP', (c) => FakeServer.ok(c.tag))
    })
    await session.fetchFullMessage('INBOX', 1)

    expect(await session.mailboxStatus('INBOX')).toEqual({ uidValidity: 1792357320n, uidNext: 10, messages: 9 })
    expect(server.commands.some((c) => c.startsWith('STATUS'))).toBe(false)
  })

  // What another connection did to an open mailbox is reported at the next command. A count read
  // from a mailbox that has been open for a while would be what it was when it was opened.
  it('brings an open mailbox up to date before reading its count', async () => {
    const { server, session } = await connected((s) => {
      s.on('SELECT', (c) => selectReply(c.tag, 9))
      s.on('UID FETCH', (c) => FakeServer.ok(c.tag))
      s.on('NOOP', (c) => `* 7 EXISTS${CRLF}* 2 EXPUNGE${CRLF}${FakeServer.ok(c.tag)}`)
    })
    await session.fetchFullMessage('INBOX', 1)

    expect((await session.mailboxStatus('INBOX')).messages).toBe(6)
    expect(server.commands.at(-1)).toBe('NOOP')
  })

  it('does the same before listing the messages of an open mailbox, and not when it has just been opened', async () => {
    const { server, session } = await connected((s) => {
      s.on('SELECT', (c) => selectReply(c.tag, 0))
      s.on('NOOP', (c) => FakeServer.ok(c.tag))
    })
    await session.syncFetch('INBOX', () => '1:*')
    expect(server.commands.some((c) => c === 'NOOP')).toBe(false)
    await session.syncFetch('INBOX', () => '1:*')
    expect(server.commands.filter((c) => c === 'NOOP')).toHaveLength(1)
  })

  describe('a folder sync against the corpus Dovecot answered', () => {
    async function sync(decide = () => '1:*') {
      const ranges: string[] = []
      const { server, session } = await connected((s) => {
        s.on('SELECT', (c) => s.replay('02-fetch', 'SELECT INBOX', c.tag))
        s.on('UID FETCH', (c) => {
          ranges.push(c.args)
          return c.args.includes('ENVELOPE')
            ? s.replay('02-fetch', 'UID FETCH 1:* (UID FLAGS RFC822.SIZE', c.tag)
            : s.replay('02-fetch', 'UID FETCH 1:* (FLAGS UID)', c.tag)
        })
      })
      const result = await session.syncFetch('INBOX', decide)
      return { server, result, ranges }
    }

    it('returns every message with its envelope decoded', async () => {
      const { result } = await sync()
      expect(result.messages.map((m) => m.uid)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
      const third = result.messages[2]
      expect(third.envelope.subject).toBe('Grüße aus München ✓')
      expect(third.envelope.from).toEqual([{ name: 'Müller, Hans', address: 'hans@example.de' }])
      expect(third.envelope.date?.toISOString()).toBe('2026-01-07T13:15:30.000Z')
      expect(third.size).toBe(547)
    })

    it('says which messages have an attachment, looking at the first level only', async () => {
      const { result } = await sync()
      const withAttachment = result.messages.filter((m) => m.hasAttachment).map((m) => m.uid)
      // 2 has a pdf, 8 an attachment next to an inline one, 9 a forwarded message. 4 has its
      // attachment two levels down, which was never counted.
      expect(withAttachment).toEqual([2, 8, 9])
    })

    it('returns the flags of everything, and the numbers the selection reported', async () => {
      const { result } = await sync()
      expect(result.flags).toHaveLength(9)
      expect(result.flags[0]).toEqual({ uid: 1, flags: ['\\Seen'] })
      expect(result.uidValidity).toBe(1792357320n)
      expect(result.uidNext).toBe(10)
    })

    it('fetches the range the caller decided on, having seen the numbers first', async () => {
      let seen: { uidValidity: bigint; uidNext: number } | null = null
      const { ranges } = await sync(((status: { uidValidity: bigint; uidNext: number }) => {
        seen = status
        return `${status.uidNext}:*`
      }) as never)
      expect(seen).toEqual({ uidValidity: 1792357320n, uidNext: 10 })
      expect(ranges[0]).toBe('10:* (UID FLAGS RFC822.SIZE ENVELOPE BODYSTRUCTURE)')
      expect(ranges[1]).toBe('1:* (UID FLAGS)')
    })

    // The server tells one connection that a message is new to it, and says so with a flag that
    // is gone from the next. Kept, it would be written on the first sync and again on the second.
    it('does not keep the flag that only means this connection saw the message first', async () => {
      const { session } = await connected((s) => {
        s.on('SELECT', (c) => selectReply(c.tag, 1))
        s.on('UID FETCH', (c) =>
          c.args.includes('ENVELOPE')
            ? s.replay('02-fetch', 'UID FETCH 1:* (UID FLAGS RFC822.SIZE', c.tag).replaceAll(
                '(\\Seen)',
                '(\\Seen \\Recent \\RECENT)'
              )
            : `* 1 FETCH (UID 1 FLAGS (\\Seen \\Recent))${CRLF}${FakeServer.ok(c.tag)}`
        )
      })
      const result = await session.syncFetch('INBOX', () => '1:*')
      expect(result.messages[0].flags).toEqual(['\\Seen'])
      expect(result.flags).toEqual([{ uid: 1, flags: ['\\Seen'] }])
    })

    it('refuses a range that is not one before it reaches a command', async () => {
      const { server, session } = await connected((s) => s.on('SELECT', (c) => selectReply(c.tag, 3)))
      await expect(session.syncFetch('INBOX', () => '1:*\r\nA9 DELETE INBOX')).rejects.toThrow(/Not a UID range/)
      expect(server.commands.some((c) => c.startsWith('DELETE'))).toBe(false)
    })

    it('does not fetch from an empty mailbox', async () => {
      const { server, session } = await connected((s) => s.on('SELECT', (c) => selectReply(c.tag, 0)))
      const result = await session.syncFetch('INBOX', () => '1:*')
      expect(result.messages).toEqual([])
      expect(server.commands.some((c) => c.startsWith('UID FETCH'))).toBe(false)
    })
  })

  it('fetches a whole message as bytes', async () => {
    const { server, session } = await connected((s) => {
      s.on('SELECT', (c) => s.replay('02-fetch', 'SELECT INBOX', c.tag))
      s.on('UID FETCH', (c) => s.replay('02-fetch', 'UID FETCH 1 (BODY.PEEK[])', c.tag))
    })
    const message = await session.fetchFullMessage('INBOX', 1)

    expect(decodeUtf8(message!.source)).toBe(
      'From: Alice Example <alice@example.com>\r\nTo: test@example.com\r\nSubject: Hello plain\r\n' +
        'Date: Mon, 05 Jan 2026 10:00:00 +0000\r\nMessage-ID: <m1@example.com>\r\n\r\nHello world.\r\n'
    )
    expect(server.received.at(-1)).toMatchObject({ verb: 'UID FETCH', args: '1 (BODY.PEEK[])' })
  })

  it('returns nothing for a message that is not there', async () => {
    const { session } = await connected((s) => {
      s.on('SELECT', (c) => s.replay('02-fetch', 'SELECT INBOX', c.tag))
      s.on('UID FETCH', (c) => s.replay('02-fetch', 'UID FETCH 999', c.tag))
    })
    expect(await session.fetchFullMessage('INBOX', 999)).toBeUndefined()
  })

  it('sets, adds and removes flags', async () => {
    const { server, session } = await connected((s) => {
      s.on('SELECT', (c) => selectReply(c.tag, 3))
      s.on('UID STORE', (c) => FakeServer.ok(c.tag, 'Store completed'))
    })
    await session.setFlags('INBOX', 4, ['\\Seen'])
    await session.addFlags('INBOX', 4, ['\\Flagged', '$label'])
    await session.removeFlags('INBOX', 4, ['\\Seen'])
    await session.setFlags('INBOX', 4, [])

    expect(server.received.filter((c) => c.verb === 'UID STORE').map((c) => c.args)).toEqual([
      '4 FLAGS.SILENT (\\Seen)',
      '4 +FLAGS.SILENT (\\Flagged $label)',
      '4 -FLAGS.SILENT (\\Seen)',
      '4 FLAGS.SILENT ()'
    ])
  })

  describe('moving', () => {
    it('uses MOVE and returns the numbers the target gave', async () => {
      const { server, session } = await connected((s) => {
        s.on('SELECT', (c) => s.replay('04-mutations', 'SELECT INBOX', c.tag))
        s.on('UID MOVE', (c) => s.replay('04-mutations', 'UID MOVE 3,4 Target', c.tag))
      })

      const moved = await session.moveMessages('INBOX', 'Target', [3, 4])

      expect(moved).toEqual(new Map([[3, 1], [4, 2]]))
      expect(server.received.at(-1)).toMatchObject({ verb: 'UID MOVE', args: '3:4 "Target"' })
    })

    it('copies, flags and expunges when the server has no MOVE', async () => {
      const server = dovecot(new FakeServer('* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR UIDPLUS] hi' + CRLF))
      server.on('AUTHENTICATE', (c) => `* CAPABILITY IMAP4rev1 UIDPLUS${CRLF}${FakeServer.ok(c.tag, 'Logged in')}`)
      server.on('SELECT', (c) => selectReply(c.tag, 9))
      server.on('UID COPY', (c) => `${c.tag} OK [COPYUID 7 1 3] Copy completed${CRLF}`)
      server.on('UID STORE', (c) => FakeServer.ok(c.tag))
      server.on('UID EXPUNGE', (c) => FakeServer.ok(c.tag))
      const session = open(server)
      await session.connect()

      const moved = await session.moveMessages('INBOX', 'Target', [1])

      expect(moved).toEqual(new Map([[1, 3]]))
      expect(server.commands.slice(2)).toEqual([
        'UID COPY 1 "Target"',
        'UID STORE 1 +FLAGS.SILENT (\\Deleted)',
        'UID EXPUNGE 1'
      ])
    })

    it('reports no numbers when the server gave none', async () => {
      const { session } = await connected((s) => {
        s.on('SELECT', (c) => selectReply(c.tag, 9))
        s.on('UID MOVE', (c) => FakeServer.ok(c.tag, 'Move completed'))
      })
      expect(await session.moveMessages('INBOX', 'Target', [1])).toBeNull()
    })

    it('says so when a move is refused, and names the target in the command safely', async () => {
      const { server, session } = await connected((s) => {
        s.on('SELECT', (c) => selectReply(c.tag, 9))
        s.on('UID MOVE', (c) => `${c.tag} NO [TRYCREATE] Mailbox doesn't exist${CRLF}`)
      })
      await expect(session.moveMessages('INBOX', 'a"b', [1])).rejects.toMatchObject({ code: { name: 'TRYCREATE' } })
      expect(server.received.at(-1)?.args).toBe('1 "a\\"b"')
    })
  })

  describe('deleting', () => {
    it('flags and expunges exactly those messages where the server can', async () => {
      const { server, session } = await connected((s) => {
        s.on('SELECT', (c) => selectReply(c.tag, 9))
        s.on('UID STORE', (c) => FakeServer.ok(c.tag))
        s.on('UID EXPUNGE', (c) => FakeServer.ok(c.tag))
      })
      await session.deleteMessages('INBOX', [5, 6, 9])
      expect(server.commands.slice(2)).toEqual(['UID STORE 5:6,9 +FLAGS.SILENT (\\Deleted)', 'UID EXPUNGE 5:6,9'])
    })

    it('has to expunge everything flagged when the server cannot be more exact', async () => {
      const server = new FakeServer('* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR] hi' + CRLF)
      server.on('AUTHENTICATE', (c) => `* CAPABILITY IMAP4rev1${CRLF}${FakeServer.ok(c.tag)}`)
      server.on('SELECT', (c) => selectReply(c.tag, 9))
      server.on('UID STORE', (c) => FakeServer.ok(c.tag))
      server.on('EXPUNGE', (c) => FakeServer.ok(c.tag))
      const session = open(server)
      await session.connect()
      await session.deleteMessages('INBOX', [5])
      expect(server.commands.at(-1)).toBe('EXPUNGE')
    })

    it('empties a mailbox', async () => {
      const { server, session } = await connected((s) => {
        s.on('SELECT', (c) => selectReply(c.tag, 9))
        s.on('STORE', (c) => FakeServer.ok(c.tag))
        s.on('EXPUNGE', (c) => FakeServer.ok(c.tag))
      })
      expect(await session.purgeMailbox('Trash')).toBe(9)
      expect(server.commands.slice(-2)).toEqual(['STORE 1:* +FLAGS.SILENT (\\Deleted)', 'EXPUNGE'])
    })

    it('leaves an empty mailbox alone', async () => {
      const { server, session } = await connected((s) => s.on('SELECT', (c) => selectReply(c.tag, 0)))
      expect(await session.purgeMailbox('Trash')).toBe(0)
      expect(server.commands.some((c) => c.startsWith('STORE'))).toBe(false)
    })
  })

  describe('appending', () => {
    const source = 'From: a@example.com\r\nSubject: draft\r\n\r\nbody\r\n'

    it('sends the message as a literal and returns the UID it was given', async () => {
      const server = dovecot(new FakeServer('* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR] hi' + CRLF))
      server.on('AUTHENTICATE', (c) => `* CAPABILITY IMAP4rev1${CRLF}${FakeServer.ok(c.tag)}`)
      server.on('APPEND', (c) => `${c.tag} OK [APPENDUID 1792357329 12] Append completed${CRLF}`)
      const session = open(server)
      await session.connect()

      const uid = await session.appendMessage('Drafts', source, ['\\Draft', '\\Seen'])

      expect(uid).toBe(12)
      const append = server.received.at(-1)!
      expect(append.args).toBe(`"Drafts" (\\Draft \\Seen) <literal:${source.length}>`)
      expect(decodeUtf8(append.literals[0])).toBe(source)
    })

    it('does not send the message when the server says no before asking for it', async () => {
      const server = new FakeServer('* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR] hi' + CRLF)
      server.on('AUTHENTICATE', (c) => `* CAPABILITY IMAP4rev1${CRLF}${FakeServer.ok(c.tag)}`)
      server.refuseLiterals = (tag) => `${tag} NO [TRYCREATE] Mailbox doesn't exist: NoSuchBox${CRLF}`
      const session = open(server)
      await session.connect()

      await expect(session.appendMessage('NoSuchBox', source)).rejects.toMatchObject({
        status: 'NO',
        code: { name: 'TRYCREATE' }
      })
      await settle()
      // Had the message been sent anyway, every line of it would have arrived as a command.
      expect(server.raw).toEqual([])
      expect(server.received.filter((c) => c.verb === 'FROM:')).toEqual([])
    })

    it('returns null when the server does not say what UID it gave', async () => {
      const { session } = await connected((s) => s.on('APPEND', (c) => FakeServer.ok(c.tag, 'Append completed')))
      expect(await session.appendMessage('Drafts', source, [])).toBeNull()
    })

    it('leaves out the flags when there are none', async () => {
      const { server, session } = await connected((s) => s.on('APPEND', (c) => FakeServer.ok(c.tag)))
      await session.appendMessage('Drafts', 'x', [])
      expect(server.received.at(-1)?.args).toBe('"Drafts" <literal:1>')
    })
  })

  it('creates, renames and deletes mailboxes by their encoded names', async () => {
    const { server, session } = await connected((s) => {
      for (const verb of ['CREATE', 'RENAME', 'DELETE']) s.on(verb, (c) => FakeServer.ok(c.tag))
    })
    await session.createMailbox('Entwürfe')
    await session.renameMailbox('Entwürfe', 'Projekte & Pläne')
    await session.deleteMailbox('Projekte & Pläne')

    expect(server.commands.slice(1)).toEqual([
      'CREATE "Entw&APw-rfe"',
      'RENAME "Entw&APw-rfe" "Projekte &- Pl&AOQ-ne"',
      'DELETE "Projekte &- Pl&AOQ-ne"'
    ])
  })
})

describe('what must never reach the wire', () => {
  it('refuses a flag that would end the command', async () => {
    const { server, session } = await connected((s) => s.on('SELECT', (c) => selectReply(c.tag, 3)))
    await expect(session.addFlags('INBOX', 1, ['\\Seen\r\nA9 DELETE INBOX'])).rejects.toThrow(/Not a flag/)
    // Nothing was sent on its account, not even the SELECT.
    expect(server.commands).toEqual(['AUTHENTICATE PLAIN AHRlc3QAdGVzdA=='])
  })

  it('refuses a UID that is not a number', async () => {
    const { server, session } = await connected()
    await expect(session.deleteMessages('INBOX', [1, Number.NaN])).rejects.toThrow()
    await expect(session.moveMessages('INBOX', 'Target', [])).rejects.toThrow()
    expect(server.commands).toEqual(['AUTHENTICATE PLAIN AHRlc3QAdGVzdA=='])
  })

  it('keeps a mailbox name with a line break in it inside its quotes', async () => {
    const { server, session } = await connected((s) => s.on('CREATE', (c) => FakeServer.ok(c.tag)))
    await session.createMailbox('a\r\nA9 DELETE INBOX')
    expect(server.received.filter((c) => c.verb === 'CREATE')).toHaveLength(1)
    expect(server.received.some((c) => c.verb === 'DELETE')).toBe(false)
    expect(server.raw).toEqual([])
  })
})

describe('when things go wrong', () => {
  it('says that a mailbox could not be opened, by the code the interface translates', async () => {
    const { session } = await connected((s) =>
      s.on('SELECT', (c) => `${c.tag} NO Mailbox doesn't exist: Nope${CRLF}`)
    )
    await expect(session.fetchFullMessage('Nope', 1)).rejects.toThrow('mailboxOpenFailed:Nope')
  })

  it('rejects what was waiting when the connection drops', async () => {
    const { server, session } = await connected((s) => s.on('LIST', () => null))
    const pending = session.listMailboxes()
    await settle(20)
    server.hangUp()
    await expect(pending).rejects.toThrow(/closed/)
  })

  it('gives up on a server that stops answering, and says so to whoever listens', async () => {
    const { session } = await connected((s) => s.on('LIST', () => null))
    const errors: Error[] = []
    session.onError((e) => errors.push(e))
    await expect(session.listMailboxes()).rejects.toThrow(/stopped answering/)
    expect(errors).toHaveLength(1)
  })

  it('reports a close to a listener', async () => {
    const { server, session } = await connected()
    let closed = false
    session.onClose(() => (closed = true))
    server.hangUp()
    await settle(20)
    expect(closed).toBe(true)
  })

  it('refuses to work after the connection is gone', async () => {
    const { server, session } = await connected()
    server.hangUp()
    await settle(20)
    await expect(session.listMailboxes()).rejects.toThrow(/closed/)
  })

  it('does not mix up two operations started together', async () => {
    const { server, session } = await connected((s) => {
      s.on('SELECT', (c) => selectReply(c.tag, 2))
      s.on('UID FETCH', (c) => FakeServer.ok(c.tag))
    })
    await Promise.all([
      session.fetchFullMessage('A', 1),
      session.fetchFullMessage('B', 2),
      session.fetchFullMessage('A', 3)
    ])
    expect(server.commands.slice(1)).toEqual([
      'SELECT "A"',
      'UID FETCH 1 (BODY.PEEK[])',
      'SELECT "B"',
      'UID FETCH 2 (BODY.PEEK[])',
      'SELECT "A"',
      'UID FETCH 3 (BODY.PEEK[])'
    ])
  })

  it('reads a tagged answer that arrives in pieces', async () => {
    const { server, session } = await connected((s) => s.on('LIST', () => null))
    const pending = session.pathDelimiter()
    await settle(20)
    const tag = server.received.at(-1)!.tag
    const whole = `* LIST (\\Noselect) "/" ""${CRLF}${tag} OK List completed${CRLF}`
    for (const piece of [whole.slice(0, 7), whole.slice(7, 20), whole.slice(20)]) {
      server.send(piece)
      await settle(5)
    }
    expect(await pending).toBe('/')
  })
})

describe('keeping watch', () => {
  async function watching() {
    const arrivals: number[] = []
    const { server, session } = await connected((s) => {
      s.on('SELECT', (c) => selectReply(c.tag, 9))
      s.on('IDLE', () => `+ idling${CRLF}`)
      s.on('UID FETCH', (c) => FakeServer.ok(c.tag))
      s.on('UID STORE', (c) => FakeServer.ok(c.tag))
    })
    session.watchMailbox('INBOX', () => arrivals.push(arrivals.length + 1))
    await settle(120)
    return { server, session, arrivals }
  }

  it('selects the watched mailbox and listens there', async () => {
    const { server } = await watching()
    expect(server.commands.slice(1)).toEqual(['SELECT "INBOX"', 'IDLE'])
  })

  it('reports a message that arrives', async () => {
    const { server, arrivals } = await watching()
    server.send(`* 10 EXISTS${CRLF}`)
    await settle()
    expect(arrivals).toEqual([1])
  })

  it('does not report a message being removed, or a count that did not grow', async () => {
    const { server, arrivals } = await watching()
    server.send(`* 8 EXISTS${CRLF}`)
    await settle(30)
    server.send(`* 8 EXISTS${CRLF}`)
    await settle(30)
    server.send(`* 3 EXPUNGE${CRLF}`)
    await settle(30)
    expect(arrivals).toEqual([])
  })

  it('ends the listening before a command and returns to it afterwards', async () => {
    const { server, session } = await watching()

    await session.fetchFullMessage('INBOX', 1)
    expect(server.raw).toEqual(['DONE'])
    // The DONE came before the FETCH, which is the only order the protocol allows.
    const verbs = server.received.map((c) => c.verb)
    expect(verbs.indexOf('UID FETCH')).toBeGreaterThan(verbs.indexOf('IDLE'))

    await settle(120)
    expect(server.received.filter((c) => c.verb === 'IDLE')).toHaveLength(2)
  })

  it('goes back to the watched mailbox after working in another one', async () => {
    const { server, session } = await watching()
    await session.fetchFullMessage('Archive', 1)
    await settle(120)
    expect(server.commands.slice(-2)).toEqual(['SELECT "INBOX"', 'IDLE'])
  })

  it('leaves quietly', async () => {
    const { server, session } = await watching()
    await session.disconnect()
    expect(server.commands.at(-1)).toBe('LOGOUT')
    expect(server.closed).toBe(true)
  })

  it('does not listen on a server that has no IDLE', async () => {
    const server = new FakeServer('* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR] hi' + CRLF)
    server.on('AUTHENTICATE', (c) => `* CAPABILITY IMAP4rev1${CRLF}${FakeServer.ok(c.tag)}`)
    server.on('SELECT', (c) => selectReply(c.tag, 9))
    const session = open(server)
    await session.connect()
    session.watchMailbox('INBOX', () => undefined)
    await settle(120)
    expect(server.commands.slice(1)).toEqual(['SELECT "INBOX"'])
  })
})
