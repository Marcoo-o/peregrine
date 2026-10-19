import { describe, expect, it } from 'vitest'
import { FakeSmtpServer } from '../test-support/fakeServer'
import { SmtpClient, type LogEvent, type OutgoingMessage, type SmtpOptions } from './client'
import { SmtpError } from './errors'

const bytes = (text: string): Uint8Array => Uint8Array.from(text, (c) => c.charCodeAt(0))
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

function setup(options: Partial<SmtpOptions> = {}, server = new FakeSmtpServer()) {
  const log: LogEvent[] = []
  const client = new SmtpClient(server.transport, {
    host: 'mail.example.org',
    port: 587,
    secure: 'starttls',
    username: 'user',
    password: 'pass',
    log: (event) => log.push(event),
    greetingTimeoutMs: 400,
    commandTimeoutMs: 400,
    dataTimeoutMs: 400,
    ...options
  })
  return { server, client, log }
}

const message = (over: Partial<OutgoingMessage> = {}): OutgoingMessage => ({
  from: 'alex@example.org',
  to: ['anna@example.net'],
  data: bytes('Subject: Hi\r\n\r\nHello\r\n'),
  ...over
})

async function failureOf(promise: Promise<unknown>): Promise<SmtpError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(SmtpError)
    return error as SmtpError
  }
  throw new Error('it did not fail')
}

describe('connecting', () => {
  it('encrypts from the start when asked to, and goes on without STARTTLS', async () => {
    const { server, client } = setup({ secure: 'tls', port: 465 })
    await client.connect()
    expect(server.connectedWith).toMatchObject({ host: 'mail.example.org', port: 465, tls: true })
    expect(server.received.map((line) => line.split(' ')[0])).toEqual(['EHLO', 'AUTH'])
  })

  it('upgrades with STARTTLS, asks again what the server offers, and only then logs in', async () => {
    const { server, client } = setup()
    await client.connect()
    expect(server.connectedWith?.tls).toBe(false)
    expect(server.tlsStarted).toBe(true)
    expect(server.received.map((line) => line.split(' ')[0])).toEqual(['EHLO', 'STARTTLS', 'EHLO', 'AUTH'])
  })

  // The reason this client exists in this form: going on without encryption because the server did
  // not offer it hands the password to anybody who removes a line from the exchange.
  it('fails closed when STARTTLS is not offered, and sends nothing', async () => {
    const server = new FakeSmtpServer()
    server.extensions = () => ['8BITMIME', 'AUTH PLAIN LOGIN']
    const { client } = setup({}, server)
    const error = await failureOf(client.connect())
    expect(error.kind).toBe('tls')
    expect(server.received.map((line) => line.split(' ')[0])).toEqual(['EHLO'])
    expect(server.closed).toBe(true)
  })

  it('fails closed when the server refuses to start encryption', async () => {
    const server = new FakeSmtpServer()
    server.on('STARTTLS', () => '454 4.7.0 TLS not available\r\n')
    const error = await failureOf(setup({}, server).client.connect())
    expect(error.kind).toBe('tls')
    expect(error.temporary).toBe(true)
    expect(server.received.some((line) => line.startsWith('AUTH'))).toBe(false)
  })

  it('fails closed when the handshake fails, as it does for a certificate that is not the right one', async () => {
    const server = new FakeSmtpServer()
    server.tlsFails = true
    const error = await failureOf(setup({}, server).client.connect())
    expect(error.kind).toBe('tls')
    expect(error.message).toMatch(/certificate/)
    expect(server.received.some((line) => line.startsWith('AUTH'))).toBe(false)
  })

  it('takes nothing that came over the clear connection after STARTTLS for an answer', async () => {
    const server = new FakeSmtpServer()
    // A reply that arrives with the 220, from whoever is in the middle, would otherwise be taken for
    // the answer to the next EHLO, and the client would act on extensions the server never listed.
    server.on('STARTTLS', () => '220 Ready\r\n250 INJECTED\r\n')
    const { client } = setup({}, server)
    await client.connect()
    expect(server.received.map((line) => line.split(' ')[0])).toEqual(['EHLO', 'STARTTLS', 'EHLO', 'AUTH'])
  })

  it('does not send the password over a connection that is not encrypted, when the server does not ask for it', async () => {
    const server = new FakeSmtpServer()
    const error = await failureOf(setup({ secure: 'none' }, server).client.connect())
    expect(error.kind).toBe('auth')
    expect(server.received.some((line) => line.startsWith('AUTH'))).toBe(false)
  })

  it('does not start encryption that was not asked for', async () => {
    const server = new FakeSmtpServer()
    const { client } = setup({ secure: 'none', username: undefined, password: undefined }, server)
    await client.connect()
    expect(server.received.some((line) => line === 'STARTTLS')).toBe(false)
    expect(server.tlsStarted).toBe(false)
  })

  it('falls back to HELO for a server that does not know EHLO, and then cannot encrypt', async () => {
    const server = new FakeSmtpServer()
    server.on('EHLO', () => '502 5.5.1 Not implemented\r\n')
    const plain = setup({ secure: 'none', username: undefined, password: undefined }, server)
    await plain.client.connect()
    expect(server.received.map((line) => line.split(' ')[0])).toEqual(['EHLO', 'HELO'])

    const second = new FakeSmtpServer()
    second.on('EHLO', () => '502 5.5.1 Not implemented\r\n')
    const error = await failureOf(setup({}, second).client.connect())
    expect(error.kind).toBe('tls')
  })

  it('reports a greeting that is a refusal', async () => {
    const server = new FakeSmtpServer('554 5.3.2 No service here\r\n')
    const error = await failureOf(setup({}, server).client.connect())
    expect(error.kind).toBe('connection')
    expect(error.code).toBe(554)
    expect(error.temporary).toBe(false)
  })

  it('reports a server that says nothing as a timeout, which may be tried again', async () => {
    const error = await failureOf(setup({ greetingTimeoutMs: 30 }, new FakeSmtpServer(null)).client.connect())
    expect(error.kind).toBe('timeout')
    expect(error.temporary).toBe(true)
  })

  it('reports a reply that is not SMTP as a protocol error', async () => {
    const server = new FakeSmtpServer('Welcome to my server\r\n')
    const error = await failureOf(setup({}, server).client.connect())
    expect(error.kind).toBe('protocol')
  })

  it('names itself with a name it has checked, and not with what it was given if that is not a name', async () => {
    const good = setup({ clientName: 'phone.example.org', secure: 'tls' })
    await good.client.connect()
    expect(good.server.received[0]).toBe('EHLO phone.example.org')

    const bad = setup({ clientName: 'x\r\nRSET', secure: 'tls' })
    await bad.client.connect()
    expect(bad.server.received[0]).toBe('EHLO localhost')
  })
})

describe('logging in', () => {
  it('logs in with PLAIN, and the log shows neither the password nor what it was turned into', async () => {
    const { client, log } = setup()
    await client.connect()
    const shown = log.map((event) => event.text).join('\n')
    expect(shown).toContain('AUTH PLAIN ***')
    expect(shown).not.toContain('pass')
    expect(shown).not.toContain(btoa('\u0000user\u0000pass'))
  })

  it('logs in with LOGIN when that is all there is, and masks both answers', async () => {
    const server = new FakeSmtpServer()
    server.extensions = (encrypted) => (encrypted ? ['AUTH LOGIN'] : ['STARTTLS'])
    const { client, log } = setup({}, server)
    await client.connect()
    expect(server.received.slice(-3)).toEqual(['AUTH LOGIN', '<login user>', '<login password>'])
    const shown = log.map((event) => event.text).join('\n')
    expect(shown).not.toContain(btoa('user'))
    expect(shown).not.toContain(btoa('pass'))
    expect(shown).toContain('***')
  })

  it('reads the older way of listing mechanisms, AUTH=PLAIN', async () => {
    const server = new FakeSmtpServer()
    server.extensions = (encrypted) => (encrypted ? ['AUTH=PLAIN'] : ['STARTTLS'])
    await setup({}, server).client.connect()
    expect(server.received.at(-1)).toMatch(/^AUTH PLAIN /)
  })

  it('reports a refused login as one, which is not a reason to try again', async () => {
    const error = await failureOf(setup({ password: 'wrong' }).client.connect())
    expect(error.kind).toBe('auth')
    expect(error.code).toBe(535)
    expect(error.temporary).toBe(false)
  })

  it('reports a login that failed for the moment as one that may be tried again', async () => {
    const server = new FakeSmtpServer()
    server.on('AUTH', () => '454 4.7.0 Temporary authentication failure\r\n')
    const error = await failureOf(setup({}, server).client.connect())
    expect(error.kind).toBe('auth')
    expect(error.temporary).toBe(true)
  })

  it('does not send a password when the server lists no login at all', async () => {
    const server = new FakeSmtpServer()
    server.extensions = (encrypted) => (encrypted ? ['8BITMIME'] : ['STARTTLS'])
    const error = await failureOf(setup({}, server).client.connect())
    expect(error.kind).toBe('auth')
    expect(server.received.some((line) => line.startsWith('AUTH'))).toBe(false)
  })

  it('does not log in with a mechanism it does not know', async () => {
    const server = new FakeSmtpServer()
    server.extensions = (encrypted) => (encrypted ? ['AUTH XOAUTH2 CRAM-MD5'] : ['STARTTLS'])
    const error = await failureOf(setup({}, server).client.connect())
    expect(error.kind).toBe('auth')
    expect(error.message).toMatch(/XOAUTH2/)
  })

  it('refuses to log in with half of a login', async () => {
    const error = await failureOf(setup({ password: undefined }).client.connect())
    expect(error.kind).toBe('auth')
  })

  it('sends mail without a login when none is given, for a server that takes it', async () => {
    const { client, server } = setup({ username: undefined, password: undefined })
    await client.connect()
    expect(server.received.some((line) => line.startsWith('AUTH'))).toBe(false)
  })
})

describe('sending', () => {
  it('sends a message and says to whom it went', async () => {
    const { client, server } = setup()
    await client.connect()
    const result = await client.send(message({ to: ['anna@example.net', 'bert@example.com'] }))
    expect(result.accepted).toEqual(['anna@example.net', 'bert@example.com'])
    expect(result.rejected).toEqual([])
    expect(result.response).toContain('queued as FAKE1')
    const sent = server.received.slice(-4)
    expect(sent[0]).toMatch(/^MAIL FROM:<alex@example\.org> SIZE=\d+$/)
    expect(sent.slice(1)).toEqual(['RCPT TO:<anna@example.net>', 'RCPT TO:<bert@example.com>', 'DATA'])
    expect(server.message()).toBe('Subject: Hi\r\n\r\nHello\r\n.\r\n')
  })

  it('sends a recipient once, however often it is listed', async () => {
    const { client, server } = setup()
    await client.connect()
    await client.send(message({ to: ['anna@example.net', 'anna@example.net'] }))
    expect(server.received.filter((line) => line.startsWith('RCPT'))).toHaveLength(1)
  })

  it('stuffs the dots, ends the lines properly and ends the message', async () => {
    const { client, server } = setup()
    await client.connect()
    await client.send(message({ data: bytes('a\n.\nb') }))
    expect(server.message()).toBe('a\r\n..\r\nb\r\n.\r\n')
  })

  it('sends a large message in pieces, and all of it', async () => {
    const { client, server } = setup()
    await client.connect()
    const line = `${'x'.repeat(76)}\r\n`
    const body = line.repeat(6000)
    await client.send(message({ data: bytes(`Subject: big\r\n\r\n${body}`) }))
    expect(server.message()).toBe(`Subject: big\r\n\r\n${body}.\r\n`)
  })

  it('reports a recipient that was refused while the others were taken', async () => {
    const { client, server } = setup()
    server.on('RCPT', (args) => (args.includes('nobody') ? '550 5.1.1 No such user\r\n' : '250 OK\r\n'))
    await client.connect()
    const result = await client.send(message({ to: ['anna@example.net', 'nobody@example.com'] }))
    expect(result.accepted).toEqual(['anna@example.net'])
    expect(result.rejected).toEqual([{ address: 'nobody@example.com', code: 550, message: '5.1.1 No such user' }])
  })

  it('fails when every recipient is refused, resets, and can send the next message', async () => {
    const { client, server } = setup()
    let refuse = true
    server.on('RCPT', () => (refuse ? '550 5.1.1 No such user\r\n' : '250 OK\r\n'))
    await client.connect()
    const error = await failureOf(client.send(message()))
    expect(error.kind).toBe('recipient')
    expect(error.code).toBe(550)
    expect(error.temporary).toBe(false)
    expect(server.received.at(-1)).toBe('RSET')

    refuse = false
    expect((await client.send(message())).accepted).toEqual(['anna@example.net'])
  })

  it('reports a refused sender and resets', async () => {
    const { client, server } = setup()
    server.on('MAIL', () => '553 5.7.1 Sender not allowed\r\n')
    await client.connect()
    const error = await failureOf(client.send(message()))
    expect(error.kind).toBe('sender')
    expect(server.received.at(-1)).toBe('RSET')
  })

  it('reports a server that will not take the message', async () => {
    const { client, server } = setup()
    server.on('DATA', () => '554 5.3.0 Transaction failed\r\n')
    await client.connect()
    const error = await failureOf(client.send(message()))
    expect(error.kind).toBe('rejected')
    expect(server.received.at(-1)).toBe('RSET')
  })

  it('tells a refusal for the moment from one for good, as the server does', async () => {
    const { client, server } = setup()
    server.on('.', () => '452 4.3.1 Insufficient system storage\r\n')
    await client.connect()
    const later = await failureOf(client.send(message()))
    expect(later.kind).toBe('rejected')
    expect(later.temporary).toBe(true)

    server.on('.', () => '554 5.7.1 Message looks like spam\r\n')
    const never = await failureOf(client.send(message()))
    expect(never.temporary).toBe(false)
    expect(never.response).toBe('554 5.7.1 Message looks like spam')
  })

  it('reads an answer that arrives in pieces', async () => {
    const { client, server } = setup()
    server.on('RCPT', () => ['25', '0 O', 'K\r\n'])
    await client.connect()
    expect((await client.send(message())).accepted).toEqual(['anna@example.net'])
  })

  it('reports a connection that ends in the middle of the message', async () => {
    const { client, server } = setup()
    server.on('.', () => {
      server.hangUp()
      return null
    })
    await client.connect()
    const error = await failureOf(client.send(message()))
    expect(error.kind).toBe('closed')
    expect(error.temporary).toBe(true)
    // and a closed connection stays closed
    expect((await failureOf(client.send(message()))).kind).toBe('closed')
  })

  it('reports a server that does not answer after the message', async () => {
    const { client, server } = setup({ dataTimeoutMs: 40 })
    server.on('.', () => null)
    await client.connect()
    const error = await failureOf(client.send(message()))
    expect(error.kind).toBe('timeout')
  })
})

describe('what is refused before anything is sent', () => {
  async function refusedWith(over: Partial<OutgoingMessage>) {
    const { client, server } = setup()
    await client.connect()
    const before = server.received.length
    const error = await failureOf(client.send(message(over)))
    expect(error.kind).toBe('invalid')
    // not one command of the exchange was sent
    expect(server.received).toHaveLength(before)
    return error
  }

  // An address goes straight into `RCPT TO:<…>`. One that carries a line break and a command makes
  // the client say that command to the server.
  it('an address that would end the command and start another', async () => {
    await refusedWith({ to: ['anna@example.net>\r\nRSET\r\nMAIL FROM:<evil@example.org'] })
    await refusedWith({ from: 'alex@example.org>\r\nRCPT TO:<evil@example.org' })
    await refusedWith({ to: ['anna@example.net\nDATA'] })
    await refusedWith({ to: ['anna@example.net x'] })
  })

  it('an address that is not one', async () => {
    for (const to of ['', 'anna', '@example.net', 'anna@', 'a nna@example.net', '<anna@example.net>', 'a"b@example.net']) {
      await refusedWith({ to: [to] })
    }
  })

  it('a message nobody is to receive', async () => {
    await refusedWith({ to: [] })
  })

  it('8-bit text for a server that did not say it takes it', async () => {
    const server = new FakeSmtpServer()
    server.extensions = (encrypted) => (encrypted ? ['AUTH PLAIN'] : ['STARTTLS'])
    const { client } = setup({}, server)
    await client.connect()
    const error = await failureOf(client.send(message({ data: Uint8Array.from([72, 105, 13, 10, 200]) })))
    expect(error.kind).toBe('invalid')
  })

  it('declares 8-bit text when the server takes it', async () => {
    const { client, server } = setup()
    await client.connect()
    await client.send(message({ data: Uint8Array.from([72, 105, 13, 10, 200, 13, 10]) }))
    expect(server.received.find((line) => line.startsWith('MAIL'))).toMatch(/ BODY=8BITMIME$/)
  })

  it('a message larger than the server says it takes', async () => {
    const server = new FakeSmtpServer()
    server.extensions = (encrypted) => (encrypted ? ['SIZE 50', 'AUTH PLAIN'] : ['STARTTLS'])
    const { client } = setup({}, server)
    await client.connect()
    const before = server.received.length
    const error = await failureOf(client.send(message({ data: bytes(`Subject: x\r\n\r\n${'y'.repeat(200)}\r\n`) })))
    expect(error.kind).toBe('rejected')
    expect(error.message).toMatch(/at most 50/)
    expect(server.received).toHaveLength(before)
  })

  it('an address beyond ASCII for a server without SMTPUTF8, and declares it for one with', async () => {
    const without = new FakeSmtpServer()
    without.extensions = (encrypted) => (encrypted ? ['AUTH PLAIN'] : ['STARTTLS'])
    const a = setup({}, without)
    await a.client.connect()
    expect((await failureOf(a.client.send(message({ to: ['jörg@example.net'] })))).kind).toBe('invalid')

    const b = setup()
    await b.client.connect()
    await b.client.send(message({ to: ['jörg@example.net'] }))
    expect(b.server.received.find((line) => line.startsWith('MAIL'))).toMatch(/ SMTPUTF8$/)
    expect(b.server.received.find((line) => line.startsWith('RCPT'))).toBe('RCPT TO:<jörg@example.net>')
  })
})

describe('closing', () => {
  it('says goodbye and closes', async () => {
    const { client, server } = setup()
    await client.connect()
    await client.close()
    expect(server.received.at(-1)).toBe('QUIT')
    expect(server.closed).toBe(true)
  })

  it('closes without a word to a connection that is already gone, and never throws', async () => {
    const { client, server } = setup()
    await client.connect()
    server.hangUp()
    await new Promise((resolve) => setTimeout(resolve, 10))
    await expect(client.close()).resolves.toBeUndefined()
  })
})

describe('the log', () => {
  it('shows both sides of the exchange, line by line', async () => {
    const { client, log } = setup({ secure: 'tls', username: undefined, password: undefined })
    await client.connect()
    await client.send(message())
    const lines = log.map((event) => `${event.direction}: ${event.text}`)
    expect(lines[0]).toBe('S: 220 fake.example ESMTP ready')
    expect(lines).toContain('C: EHLO localhost')
    expect(lines).toContain('S: 250-8BITMIME')
    expect(lines.some((line) => line.startsWith('C: <message, '))).toBe(true)
    expect(lines.at(-1)).toMatch(/^S: 250 2\.0\.0 OK queued as FAKE1$/)
  })
})
