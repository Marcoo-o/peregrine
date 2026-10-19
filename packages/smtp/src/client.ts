import type { SecureMode } from '@peregrine/core/types'
import { encodeBase64 } from '@peregrine/imap/mime'
import type { Transport } from '@peregrine/imap/transport'
import { encodeUtf8 } from '@peregrine/imap/utf8'
import { checkAddress, isAscii } from './address'
import { hasEightBit, prepareData } from './data'
import { SmtpError, type SmtpErrorKind } from './errors'
import { ReplyReader, type Reply } from './reply'

/** One line of the exchange, for the diagnostics log. Credentials are already masked. */
export interface LogEvent {
  direction: 'C' | 'S'
  text: string
}

export interface SmtpOptions {
  host: string
  port: number
  secure: SecureMode
  /** Without both, nothing is logged in and the server has to take mail from anybody. */
  username?: string
  password?: string
  /** The name given in EHLO. */
  clientName?: string
  log?: (event: LogEvent) => void
  greetingTimeoutMs?: number
  commandTimeoutMs?: number
  /** For the answer after the message, which a large one makes the server take a while over. */
  dataTimeoutMs?: number
}

export interface OutgoingMessage {
  /** The sender in the envelope. Not the one in the header, which is the message's own business. */
  from: string
  /** Everybody the message is to reach: to, cc and bcc together. */
  to: string[]
  /** The message as RFC 5322 source. Line ends are corrected on the way out, see `prepareData`. */
  data: Uint8Array
}

export interface SendResult {
  accepted: string[]
  /** Recipients the server refused while taking the others. The message has not gone to them. */
  rejected: { address: string; code: number; message: string }[]
  /** The server's last word, which often carries the id under which it queued the message. */
  response: string
}

const GREETING_TIMEOUT_MS = 30_000
const COMMAND_TIMEOUT_MS = 60_000
const DATA_TIMEOUT_MS = 180_000
const QUIT_TIMEOUT_MS = 3_000
/** A message goes out in pieces of this size, which a phone's bridge to the network carries better. */
const WRITE_CHUNK = 64 * 1024

/**
 * Sends mail over SMTP, over a transport it is handed.
 *
 * One command at a time, each answered before the next. That is slower than pipelining by a few
 * round trips, which for one message is nothing, and it leaves no state to get wrong: what the
 * server said last is what the client answers.
 *
 * Encryption is not negotiable. With `starttls` the server has to offer it, or nothing is sent and
 * the error says so: a client that goes on without, because the server did not offer it, hands the
 * password to anybody who removes one line from the exchange. The same goes for a handshake that
 * fails. The certificate is checked by the transport, against the host that was asked for.
 */
export class SmtpClient {
  private readonly reader = new ReplyReader()
  private readonly arrived: Reply[] = []
  private waiter: {
    resolve: (reply: Reply) => void
    reject: (error: SmtpError) => void
    timer: ReturnType<typeof setTimeout>
  } | null = null
  private failure: SmtpError | null = null
  private extensions = new Map<string, string[]>()
  private encrypted = false

  constructor(
    private readonly transport: Transport,
    private readonly options: SmtpOptions
  ) {
    transport.onData((bytes) => this.receive(bytes))
    transport.onClose((error) => this.fail(new SmtpError('closed', error?.message ?? 'The server closed the connection')))
  }

  /** Connects, encrypts if asked to, and logs in if there is a login. Throws an `SmtpError`. */
  async connect(): Promise<void> {
    const { host, port, secure } = this.options
    try {
      await this.transport.connect({ host, port, tls: secure === 'tls' })
    } catch (error) {
      throw this.fail(new SmtpError(secure === 'tls' ? 'tls' : 'connection', messageOf(error)))
    }
    this.encrypted = secure === 'tls'

    const greeting = await this.readReply(this.options.greetingTimeoutMs ?? GREETING_TIMEOUT_MS)
    if (greeting.code !== 220) throw this.fail(this.refused(greeting, 'connection', 'The server did not welcome us'))

    await this.hello()
    if (secure === 'starttls') {
      if (!this.extensions.has('STARTTLS')) {
        throw this.fail(new SmtpError('tls', 'The server does not offer encryption, so nothing was sent'))
      }
      await this.upgrade()
    }
    await this.authenticate()
  }

  /**
   * Sends one message and says who it went to. Throws an `SmtpError` when it did not go to anybody.
   * The connection can be used again after an error of the kinds `sender`, `recipient` and
   * `rejected`, which end the exchange with a reset. After any other it cannot.
   */
  async send(message: OutgoingMessage): Promise<SendResult> {
    if (this.failure) throw this.failure
    const recipients = [...new Set(message.to)]
    if (recipients.length === 0) throw new SmtpError('invalid', 'There is no recipient')
    checkAddress(message.from, 'sender')
    for (const address of recipients) checkAddress(address, 'recipient')

    // What the server has to have said it takes, found out before the first command and not by
    // being refused halfway.
    const international = [message.from, ...recipients].some((address) => !isAscii(address))
    if (international && !this.extensions.has('SMTPUTF8')) {
      throw new SmtpError('invalid', 'An address has characters beyond ASCII, which this server does not take')
    }
    const eightBit = hasEightBit(message.data)
    if (eightBit && !this.extensions.has('8BITMIME')) {
      throw new SmtpError('invalid', 'The message has 8-bit text, which this server does not take. It has to be encoded')
    }
    const data = prepareData(message.data)
    const limit = Number(this.extensions.get('SIZE')?.[0] ?? 0)
    if (limit > 0 && data.length > limit) {
      throw new SmtpError('rejected', `The message is larger than the server takes: ${data.length} bytes, at most ${limit}`)
    }

    let mailFrom = `MAIL FROM:<${message.from}>`
    if (this.extensions.has('SIZE')) mailFrom += ` SIZE=${data.length}`
    if (eightBit) mailFrom += ' BODY=8BITMIME'
    if (international) mailFrom += ' SMTPUTF8'

    try {
      const sender = await this.command(mailFrom)
      if (sender.code !== 250) throw this.refused(sender, 'sender', 'The server refused the sender')

      const accepted: string[] = []
      const rejected: SendResult['rejected'] = []
      for (const address of recipients) {
        const reply = await this.command(`RCPT TO:<${address}>`)
        if (reply.code === 250 || reply.code === 251) accepted.push(address)
        else rejected.push({ address, code: reply.code, message: reply.lines.join(' ') })
      }
      if (accepted.length === 0) {
        throw new SmtpError('recipient', `The server refused every recipient: ${rejected[0].code} ${rejected[0].message}`, {
          code: rejected[0].code,
          response: `${rejected[0].code} ${rejected[0].message}`
        })
      }

      const go = await this.command('DATA')
      if (go.code !== 354) throw this.refused(go, 'rejected', 'The server would not take the message')
      this.log('C', `<message, ${data.length} bytes>`)
      for (let at = 0; at < data.length; at += WRITE_CHUNK) {
        await this.writeBytes(data.subarray(at, at + WRITE_CHUNK))
      }
      const done = await this.readReply(this.options.dataTimeoutMs ?? DATA_TIMEOUT_MS)
      if (done.code !== 250) throw this.refused(done, 'rejected', 'The server refused the message')
      return { accepted, rejected, response: `${done.code} ${done.lines.join(' ')}`.trim() }
    } catch (error) {
      await this.reset(error)
      throw error
    }
  }

  /** Says goodbye and closes. Never throws. */
  async close(): Promise<void> {
    if (!this.failure) {
      try {
        await this.command('QUIT', 'QUIT', QUIT_TIMEOUT_MS)
      } catch {
        // The goodbye is a courtesy, and the connection is closed either way.
      }
    }
    this.transport.close()
  }

  // The start of a conversation

  private async hello(): Promise<void> {
    const name = helloName(this.options.clientName)
    let reply = await this.command(`EHLO ${name}`)
    if (reply.code === 250) {
      this.extensions = parseExtensions(reply.lines.slice(1))
      return
    }
    // A server too old to know EHLO says so with a 5yz and takes HELO, which has no extensions.
    if (reply.code >= 500) {
      reply = await this.command(`HELO ${name}`)
      if (reply.code === 250) {
        this.extensions = new Map()
        return
      }
    }
    throw this.fail(this.refused(reply, 'connection', 'The server did not take our greeting'))
  }

  private async upgrade(): Promise<void> {
    const reply = await this.command('STARTTLS')
    if (reply.code !== 220) throw this.fail(this.refused(reply, 'tls', 'The server would not start encryption'))
    // Whatever arrived with that reply, or after it, came over the clear connection.
    this.reader.reset()
    this.arrived.length = 0
    try {
      await this.transport.startTls(this.options.host)
    } catch (error) {
      throw this.fail(new SmtpError('tls', messageOf(error)))
    }
    this.encrypted = true
    // What the server offered before is not what it offers now, and may have been tampered with.
    this.extensions = new Map()
    await this.hello()
  }

  private async authenticate(): Promise<void> {
    const { username, password } = this.options
    if (username === undefined && password === undefined) return
    if (username === undefined || password === undefined) {
      throw this.fail(new SmtpError('auth', 'A user name and a password are both needed to log in'))
    }
    const offered = this.extensions.get('AUTH')
    if (!offered) {
      throw this.fail(new SmtpError('auth', 'The server does not offer a login, so the password was not sent'))
    }
    if (offered.includes('PLAIN')) {
      const secret = encodeBase64(encodeUtf8(`\u0000${username}\u0000${password}`))
      const reply = await this.command(`AUTH PLAIN ${secret}`, 'AUTH PLAIN ***')
      if (reply.code !== 235) throw this.fail(this.refused(reply, 'auth', 'The server refused the login'))
    } else if (offered.includes('LOGIN')) {
      let reply = await this.command('AUTH LOGIN')
      if (reply.code !== 334) throw this.fail(this.refused(reply, 'auth', 'The server did not start the login'))
      reply = await this.command(encodeBase64(encodeUtf8(username)), '***')
      if (reply.code !== 334) throw this.fail(this.refused(reply, 'auth', 'The server refused the login'))
      reply = await this.command(encodeBase64(encodeUtf8(password)), '***')
      if (reply.code !== 235) throw this.fail(this.refused(reply, 'auth', 'The server refused the login'))
    } else {
      throw this.fail(new SmtpError('auth', `The server offers no login this can use: ${offered.join(', ')}`))
    }
  }

  // The conversation

  private async command(line: string, loggable: string = line, timeoutMs = this.options.commandTimeoutMs ?? COMMAND_TIMEOUT_MS): Promise<Reply> {
    await this.writeBytes(encodeUtf8(`${line}\r\n`), loggable)
    return this.readReply(timeoutMs)
  }

  private async writeBytes(bytes: Uint8Array, loggable?: string): Promise<void> {
    if (this.failure) throw this.failure
    if (loggable !== undefined) this.log('C', loggable)
    try {
      await this.transport.write(bytes)
    } catch (error) {
      throw this.fail(new SmtpError('closed', messageOf(error)))
    }
  }

  private readReply(timeoutMs: number): Promise<Reply> {
    const next = this.arrived.shift()
    if (next) return Promise.resolve(next)
    if (this.failure) return Promise.reject(this.failure)
    return new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new SmtpError('timeout', 'The server did not answer in time'))
      }, timeoutMs)
      this.waiter = { resolve, reject, timer }
    })
  }

  private receive(bytes: Uint8Array): void {
    try {
      for (const reply of this.reader.push(bytes)) this.deliver(reply)
    } catch (error) {
      this.fail(error instanceof SmtpError ? error : new SmtpError('protocol', messageOf(error)))
    }
  }

  private deliver(reply: Reply): void {
    reply.lines.forEach((line, index) => {
      this.log('S', `${reply.code}${index < reply.lines.length - 1 ? '-' : ' '}${line}`)
    })
    const waiter = this.waiter
    if (waiter) {
      this.waiter = null
      clearTimeout(waiter.timer)
      waiter.resolve(reply)
    } else {
      this.arrived.push(reply)
    }
  }

  /** Ends the connection for good, once, with the first reason. Returns the error, to be thrown. */
  private fail(error: SmtpError): SmtpError {
    if (this.failure) return this.failure
    this.failure = error
    const waiter = this.waiter
    if (waiter) {
      this.waiter = null
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
    this.transport.close()
    return error
  }

  /** After a refusal the exchange is ended with RSET, so that the connection can send the next one. */
  private async reset(error: unknown): Promise<void> {
    const kinds: SmtpErrorKind[] = ['sender', 'recipient', 'rejected']
    if (this.failure || !(error instanceof SmtpError) || !kinds.includes(error.kind)) return
    try {
      await this.command('RSET', 'RSET', QUIT_TIMEOUT_MS)
    } catch {
      // If even that is not answered, the next command finds the connection closed.
    }
  }

  private refused(reply: Reply, kind: SmtpErrorKind, what: string): SmtpError {
    const text = reply.lines.join(' ')
    return new SmtpError(kind, `${what}: ${reply.code} ${text}`.trim(), {
      code: reply.code,
      response: `${reply.code} ${text}`.trim()
    })
  }

  private log(direction: 'C' | 'S', text: string): void {
    this.options.log?.({ direction, text })
  }
}

/** What the server offers, by name in capitals. `AUTH` appears once, with everything it lists. */
function parseExtensions(lines: string[]): Map<string, string[]> {
  const found = new Map<string, string[]>()
  for (const line of lines) {
    const words = line.trim().split(/\s+/)
    let name = words[0].toUpperCase()
    let params = words.slice(1).map((word) => word.toUpperCase())
    // Some servers still list it as `AUTH=PLAIN LOGIN`, next to the proper line.
    if (name.startsWith('AUTH=')) {
      params = [name.slice(5), ...params]
      name = 'AUTH'
    }
    if (name === '') continue
    found.set(name, name === 'AUTH' ? [...(found.get('AUTH') ?? []), ...params] : params)
  }
  return found
}

/** The name for EHLO, which goes into a command and so is held to what a host name may be. */
function helloName(name: string | undefined): string {
  return name && /^[A-Za-z0-9.\-[\]:]{1,255}$/.test(name) ? name : 'localhost'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
