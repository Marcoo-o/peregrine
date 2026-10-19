import { simpleParser, type ParsedMail } from 'mailparser'
import MailComposer from 'nodemailer/lib/mail-composer'
import { SMTPServer, type SMTPServerOptions } from 'smtp-server'
import { afterEach, describe, expect, it } from 'vitest'
import { SmtpClient, type SmtpOptions } from '@peregrine/smtp/client'
import { composeMessage, type ComposeInput } from '@peregrine/smtp/compose'
import { SmtpError } from '@peregrine/smtp/errors'
import { NodeTransport } from '../imap/NodeTransport'

/**
 * The SMTP client and the composer of @peregrine/smtp against what is not ours: a real SMTP server
 * library, a real message parser, and nodemailer, which the desktop sends with today.
 *
 * The package is tested against a server it can script, which is how the cases a real one rarely
 * produces are reached. This is the other direction: an ordinary exchange with something written by
 * somebody else, and a message that somebody else's parser reads back as it was meant. A client and a
 * composer checked only against each other agree about their own mistakes.
 */

interface Received {
  from: string
  to: string[]
  data: Buffer
}

interface Running {
  port: number
  received: Received[]
  close: () => Promise<void>
}

const running: Running[] = []
afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close()))
})

function start(options: Partial<SMTPServerOptions> = {}, rejectRecipient?: (address: string) => boolean): Promise<Running> {
  const received: Received[] = []
  const server = new SMTPServer({
    // No TLS, which the package's own tests cover with a transport that can say it started: a server
    // here would need a certificate, and the check of that is the transport's, not this client's.
    disabledCommands: ['STARTTLS'],
    allowInsecureAuth: true,
    authOptional: true,
    logger: false,
    onAuth(auth, _session, callback) {
      if (auth.username === 'user' && auth.password === 'pass') callback(null, { user: 'user' })
      else callback(new Error('Invalid username or password'))
    },
    onRcptTo(address, _session, callback) {
      if (rejectRecipient?.(address.address)) {
        const error = Object.assign(new Error('No such user here'), { responseCode: 550 })
        callback(error)
      } else callback()
    },
    onData(stream, session, callback) {
      const chunks: Buffer[] = []
      stream.on('data', (chunk: Buffer) => chunks.push(chunk))
      stream.on('end', () => {
        received.push({
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '',
          to: session.envelope.rcptTo.map((r) => r.address),
          data: Buffer.concat(chunks)
        })
        callback()
      })
    },
    ...options
  })
  return new Promise((resolve, reject) => {
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      const handle = { port, received, close: () => new Promise<void>((done) => server.close(() => done())) }
      running.push(handle)
      resolve(handle)
    })
  })
}

async function send(
  server: Running,
  input: ComposeInput,
  options: Partial<SmtpOptions> = {}
) {
  const composed = composeMessage(input)
  const client = new SmtpClient(new NodeTransport(), {
    host: '127.0.0.1',
    port: server.port,
    secure: 'none',
    commandTimeoutMs: 10_000,
    dataTimeoutMs: 20_000,
    greetingTimeoutMs: 10_000,
    ...options
  })
  try {
    await client.connect()
    const result = await client.send({ from: composed.envelope.from, to: composed.envelope.to, data: composed.source })
    return { composed, result }
  } finally {
    await client.close()
  }
}

const base: ComposeInput = {
  from: { name: 'Alex Beispiel', address: 'alex@example.org' },
  to: ['anna@example.net'],
  subject: 'Hello',
  text: 'Good day\r\n'
}

describe('sending through a real SMTP server', () => {
  it('delivers the message to the server byte for byte', async () => {
    const server = await start()
    const { composed } = await send(server, base)
    expect(server.received).toHaveLength(1)
    expect(Buffer.compare(server.received[0].data, Buffer.from(composed.source))).toBe(0)
    expect(server.received[0].from).toBe('alex@example.org')
    expect(server.received[0].to).toEqual(['anna@example.net'])
  })

  it('logs in when the server asks for it', async () => {
    const server = await start({ authOptional: false })
    await send(server, base, { username: 'user', password: 'pass' })
    expect(server.received).toHaveLength(1)
  })

  it('reports a refused login the way the server said it', async () => {
    const server = await start({ authOptional: false })
    try {
      await send(server, base, { username: 'user', password: 'wrong' })
      throw new Error('it did not fail')
    } catch (error) {
      expect(error).toBeInstanceOf(SmtpError)
      expect((error as SmtpError).kind).toBe('auth')
      expect((error as SmtpError).code).toBe(535)
    }
    expect(server.received).toHaveLength(0)
  })

  it('reports a recipient the server refuses, and sends to the rest', async () => {
    const server = await start({}, (address) => address.startsWith('nobody'))
    const { result } = await send(server, { ...base, to: ['anna@example.net', 'nobody@example.com'] })
    expect(result.accepted).toEqual(['anna@example.net'])
    expect(result.rejected).toEqual([expect.objectContaining({ address: 'nobody@example.com', code: 550 })])
    expect(server.received[0].to).toEqual(['anna@example.net'])
  })

  it('does not send a message larger than the server says it takes', async () => {
    const server = await start({ size: 2000 })
    try {
      await send(server, { ...base, text: 'x'.repeat(5000) })
      throw new Error('it did not fail')
    } catch (error) {
      expect(error).toBeInstanceOf(SmtpError)
      expect((error as SmtpError).kind).toBe('rejected')
    }
    expect(server.received).toHaveLength(0)
  })

  // The attack that sends mail in another's name needs one side to read a bare line feed as a line
  // end and the other not to. The client writes every one as CR LF, so the server sees one message.
  it('is not made to send two messages by a bare line feed in the one it sends', async () => {
    const server = await start()
    const client = new SmtpClient(new NodeTransport(), { host: '127.0.0.1', port: server.port, secure: 'none' })
    await client.connect()
    const smuggled =
      'Subject: one\r\n\r\nbody\n.\nMAIL FROM:<evil@example.org>\nRCPT TO:<victim@example.net>\nDATA\n\nsecond\n'
    await client.send({ from: 'alex@example.org', to: ['anna@example.net'], data: Uint8Array.from(Buffer.from(smuggled)) })
    await client.close()
    expect(server.received).toHaveLength(1)
    expect(server.received[0].from).toBe('alex@example.org')
    expect(server.received[0].to).toEqual(['anna@example.net'])
    const text = server.received[0].data.toString()
    // all of it arrived as the one message, with the dot line undone by the server
    expect(text).toContain('body\r\n.\r\nMAIL FROM:<evil@example.org>')
  })

  it('sends several messages on one connection', async () => {
    const server = await start()
    const client = new SmtpClient(new NodeTransport(), { host: '127.0.0.1', port: server.port, secure: 'none' })
    await client.connect()
    for (let i = 0; i < 3; i++) {
      const composed = composeMessage({ ...base, subject: `message ${i}` })
      await client.send({ from: composed.envelope.from, to: composed.envelope.to, data: composed.source })
    }
    await client.close()
    expect(server.received).toHaveLength(3)
  })
})

/** What a reader makes of a message, reduced to what the two builders are supposed to agree on. */
function essentials(mail: ParsedMail) {
  const names = (field: ParsedMail['to']): string[] =>
    [field ?? []].flat().flatMap((entry) => entry.value.map((v) => `${v.name}|${v.address}`))
  return {
    subject: mail.subject,
    from: names(mail.from),
    to: names(mail.to),
    cc: names(mail.cc),
    bcc: names(mail.bcc),
    text: mail.text?.replace(/\r?\n$/, ''),
    html: typeof mail.html === 'string' ? mail.html : mail.html,
    inReplyTo: mail.inReplyTo,
    references: mail.references,
    attachments: mail.attachments.map((a) => ({ name: a.filename, type: a.contentType, size: a.size, content: a.content.toString('base64') }))
  }
}

describe('the composer against a real parser, and against nodemailer', () => {
  const content = Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 31) % 256))
  const cases: Record<string, ComposeInput> = {
    'plain text': base,
    'non-ASCII subject, names and text': {
      from: { name: 'Jörg Müller-Lüdenscheidt', address: 'joerg@example.org' },
      to: [{ name: 'Анна', address: 'anna@example.net' }, '"Beispiel, Bert" <bert@example.com>'],
      subject: 'Grüße aus München 😀 – ein sehr langer Betreff, der über mehrere Zeilen gefaltet werden muss ' + 'wort '.repeat(20),
      text: 'Liebe Grüße,\r\nein Text mit Umlauten: äöüß und einem Emoji 😀.\r\n'
    },
    'text and HTML': { ...base, text: 'plain version\r\n', html: '<p>rich <b>version</b></p>' },
    'a reply in a thread': { ...base, inReplyTo: '<two@example.net>', references: ['<one@example.net>', '<two@example.net>'] },
    'cc and bcc': { ...base, cc: ['bert@example.com'], bcc: ['carl@example.org'] },
    'attachments, one with a name that is not ASCII': {
      ...base,
      text: 'see attached\r\n',
      html: '<p>see attached</p>',
      attachments: [
        { filename: 'data.bin', contentType: 'application/octet-stream', content },
        { filename: 'Übersicht März 2026.pdf', contentType: 'application/pdf', content: Uint8Array.from(content.subarray(0, 1234)) }
      ]
    },
    'a line of one dot in the text': { ...base, text: 'before\r\n.\r\n..\r\nafter\r\n' }
  }

  for (const [name, input] of Object.entries(cases)) {
    it(`reads back as written: ${name}`, async () => {
      const server = await start()
      await send(server, input)
      const parsed = await simpleParser(server.received[0].data)
      expect(parsed.subject).toBe(input.subject)
      // the parser gives line ends as a line feed, whatever came over the wire
      expect(parsed.text?.replace(/\n$/, '')).toBe((input.text ?? '').replace(/\r\n/g, '\n').replace(/\n$/, ''))
      if (input.html) expect(parsed.html).toBe(input.html)
      expect(essentials(parsed).bcc).toEqual([])
      const attachments = input.attachments ?? []
      expect(parsed.attachments.map((a) => a.filename)).toEqual(attachments.map((a) => a.filename))
      attachments.forEach((attachment, index) => {
        expect(Buffer.compare(parsed.attachments[index].content, Buffer.from(attachment.content))).toBe(0)
      })
    })

    it(`reads the same as nodemailer builds: ${name}`, async () => {
      const ours = await simpleParser(Buffer.from(composeMessage(input).source))
      const compiled = await new Promise<Buffer>((resolve, reject) => {
        const toText = (a: ComposeInput['to'][number]): string =>
          typeof a === 'string' ? a : a.name ? `"${a.name.replace(/["\\]/g, '\\$&')}" <${a.address}>` : a.address
        new MailComposer({
          from: toText(input.from),
          to: input.to.map(toText),
          cc: input.cc?.map(toText),
          subject: input.subject,
          text: input.text,
          html: input.html,
          inReplyTo: input.inReplyTo,
          references: input.references,
          attachments: input.attachments?.map((a) => ({ filename: a.filename, contentType: a.contentType, content: Buffer.from(a.content) }))
        })
          .compile()
          .build((error, buffer) => (error ? reject(error) : resolve(buffer)))
      })
      const theirs = await simpleParser(compiled)
      const a = essentials(ours)
      const b = essentials(theirs)
      expect(a.subject).toBe(b.subject)
      expect(a.from).toEqual(b.from)
      expect(a.to).toEqual(b.to)
      expect(a.cc).toEqual(b.cc)
      expect(a.text).toBe(b.text)
      expect(a.html).toBe(b.html)
      expect(a.inReplyTo).toBe(b.inReplyTo)
      expect(a.references).toEqual(b.references)
      expect(a.attachments).toEqual(b.attachments)
    })
  }

  it('sends a large attachment through whole', async () => {
    const big = Buffer.from(Array.from({ length: 3 * 1024 * 1024 }, (_, i) => (i * 131) % 256))
    const server = await start({ size: 20 * 1024 * 1024 })
    await send(server, { ...base, attachments: [{ filename: 'big.bin', content: Uint8Array.from(big) }] })
    const parsed = await simpleParser(server.received[0].data)
    expect(Buffer.compare(parsed.attachments[0].content, big)).toBe(0)
  }, 60_000)
})
