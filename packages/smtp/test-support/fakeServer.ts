import type { Transport, TransportConnectOptions } from '@peregrine/imap/transport'
import { decodeAscii } from '@peregrine/imap/utf8'

const CRLF = '\r\n'
const bytesOf = (value: string): Uint8Array => Uint8Array.from(value, (c) => c.charCodeAt(0))

/** What a handler may answer with: text, several pieces that arrive one after the other, or nothing. */
export type Answer = string | string[] | null
export type Handler = (args: string, line: string) => Answer

/**
 * A server the tests can script, speaking just enough SMTP to be talked to.
 *
 * It answers like a server that works, and a test changes what it needs to with `on`: refuse a
 * recipient, answer in two pieces, say nothing, hang up. That makes it possible to test the client's
 * side of what a real server rarely does. For the ordinary exchange there is a real server library,
 * in the desktop's tests.
 */
export class FakeSmtpServer {
  /** Every command line the client sent, in order, with its arguments. Not the message. */
  readonly received: string[] = []
  /** The bytes after each DATA, as they arrived: stuffed, and with the line that ends the message. */
  readonly messages: Uint8Array[] = []
  readonly transport: Transport
  connectedWith: TransportConnectOptions | null = null
  tlsStarted = false
  tlsFails = false
  closed = false
  /** How many connections were made, so that what is still to happen to an old one does not happen to a new one. */
  private connections = 0
  credentials = { user: 'user', pass: 'pass' }
  /**
   * What the server lists in answer to EHLO, which depends on whether the connection is encrypted.
   * Like a submission server, it offers the login only once it is.
   */
  extensions: (encrypted: boolean) => string[] = (encrypted) =>
    encrypted
      ? ['8BITMIME', 'SIZE 5000000', 'SMTPUTF8', 'AUTH PLAIN LOGIN']
      : ['8BITMIME', 'SIZE 5000000', 'STARTTLS']

  private handlers = new Map<string, Handler>()
  private onData: (bytes: Uint8Array) => void = () => undefined
  private onClose: (error?: Error) => void = () => undefined
  private buffer = ''
  private data: string | null = null
  private loginStep: 'user' | 'pass' | null = null
  private loginUser = ''

  constructor(private greeting: string | null = '220 fake.example ESMTP ready\r\n') {
    this.transport = {
      connect: async (options) => {
        this.connectedWith = options
        this.connections++
        // A new connection starts clean: one server is used for more than one connection in a test.
        this.closed = false
        this.tlsStarted = false
        this.buffer = ''
        if (this.greeting !== null) setTimeout(() => this.send(this.greeting as string), 0)
      },
      startTls: async () => {
        if (this.tlsFails) throw new Error('certificate verify failed')
        this.tlsStarted = true
        // What the clear connection had not yet delivered is gone, as a transport has to make it.
        this.buffer = ''
      },
      write: async (bytes) => {
        this.feed(decodeAscii(bytes))
      },
      close: () => {
        if (this.closed) return
        this.closed = true
        // Told to the client of this connection, and only if no other has been made since: one fake stands for every connection, and a
        // client told too late would close the new one.
        const listener = this.onClose
        const connection = this.connections
        setTimeout(() => {
          if (connection === this.connections) listener()
        }, 0)
      },
      onData: (listener) => {
        this.onData = listener
      },
      onClose: (listener) => {
        this.onClose = listener
      }
    }
  }

  /** Replaces how the server answers a command: `on('RCPT', (args) => '550 no such user\r\n')`. */
  on(verb: string, handler: Handler): void {
    this.handlers.set(verb.toUpperCase(), handler)
  }

  /** Sends text to the client, on the server's own initiative. */
  send(text: string): void {
    if (!this.closed) this.onData(bytesOf(text))
  }

  /** Hangs up, as a server does when it has had enough. */
  hangUp(): void {
    this.transport.close()
  }

  get encrypted(): boolean {
    return this.tlsStarted || this.connectedWith?.tls === true
  }

  /** The message that was sent, as the server read it. Dot stuffing is left in. */
  message(index = 0): string {
    return decodeAscii(this.messages[index])
  }

  private feed(text: string): void {
    if (this.data !== null) {
      this.data += text
      // The message ends with a line of one dot. An empty message is that line and nothing before.
      if (this.data.endsWith(`${CRLF}.${CRLF}`) || this.data === `.${CRLF}`) this.finishData()
      return
    }
    this.buffer += text
    for (;;) {
      const at = this.buffer.indexOf(CRLF)
      if (at === -1) return
      const line = this.buffer.slice(0, at)
      this.buffer = this.buffer.slice(at + 2)
      this.command(line)
      if (this.data !== null) {
        // What followed DATA in the same piece belongs to the message.
        const rest = this.buffer
        this.buffer = ''
        this.data = ''
        if (rest) this.feed(rest)
        return
      }
    }
  }

  private finishData(): void {
    this.messages.push(bytesOf(this.data as string))
    this.data = null
    const custom = this.handlers.get('.')
    this.answer(custom ? custom('', '.') : `250 2.0.0 OK queued as FAKE${this.messages.length}${CRLF}`)
  }

  private command(raw: string): void {
    // The text is held as Latin-1, one character for each byte, so that a message comes through
    // untouched. A command is UTF-8, and is read as such.
    const line = new TextDecoder().decode(Uint8Array.from(raw, (c) => c.charCodeAt(0)))
    if (this.loginStep) {
      this.login(line)
      return
    }
    const [word, ...rest] = line.split(' ')
    const verb = word.toUpperCase()
    const args = rest.join(' ')
    this.received.push(line)

    const custom = this.handlers.get(verb)
    if (custom) {
      const answer = custom(args, line)
      if (verb === 'DATA' && typeof answer === 'string' && answer.startsWith('354')) this.data = ''
      this.answer(answer)
      return
    }
    switch (verb) {
      case 'EHLO': {
        const list = ['fake.example', ...this.extensions(this.encrypted)]
        this.answer(list.map((entry, i) => `250${i < list.length - 1 ? '-' : ' '}${entry}${CRLF}`).join(''))
        return
      }
      case 'HELO':
        this.answer(`250 fake.example${CRLF}`)
        return
      case 'STARTTLS':
        this.answer(`220 2.0.0 Ready to start TLS${CRLF}`)
        return
      case 'AUTH':
        this.auth(args)
        return
      case 'MAIL':
      case 'RCPT':
      case 'RSET':
      case 'NOOP':
        this.answer(`250 2.1.0 OK${CRLF}`)
        return
      case 'DATA':
        this.data = ''
        this.answer(`354 End data with <CR><LF>.<CR><LF>${CRLF}`)
        return
      case 'QUIT':
        this.answer(`221 2.0.0 Bye${CRLF}`)
        // After the goodbye has gone out.
        const connection = this.connections
        setTimeout(() => {
          if (connection === this.connections) this.hangUp()
        }, 5)
        return
      default:
        this.answer(`500 5.5.1 Command unrecognized${CRLF}`)
    }
  }

  private auth(args: string): void {
    const [mechanism, initial] = args.split(' ')
    if (mechanism === 'PLAIN' && initial) {
      const [, user, pass] = atob(initial).split('\u0000')
      this.answer(this.accepts(user, pass) ? `235 2.7.0 Authenticated${CRLF}` : `535 5.7.8 Authentication failed${CRLF}`)
    } else if (mechanism === 'LOGIN') {
      this.loginStep = 'user'
      this.answer(`334 VXNlcm5hbWU6${CRLF}`)
    } else {
      this.answer(`504 5.5.4 Unrecognized authentication type${CRLF}`)
    }
  }

  private login(line: string): void {
    this.received.push(this.loginStep === 'user' ? '<login user>' : '<login password>')
    if (this.loginStep === 'user') {
      this.loginUser = atob(line)
      this.loginStep = 'pass'
      this.answer(`334 UGFzc3dvcmQ6${CRLF}`)
      return
    }
    this.loginStep = null
    const ok = this.accepts(this.loginUser, atob(line))
    this.answer(ok ? `235 2.7.0 Authenticated${CRLF}` : `535 5.7.8 Authentication failed${CRLF}`)
  }

  private accepts(user: string, pass: string): boolean {
    return user === this.credentials.user && pass === this.credentials.pass
  }

  private answer(answer: Answer): void {
    if (answer === null) return
    const pieces = typeof answer === 'string' ? [answer] : answer
    pieces.forEach((piece, i) => setTimeout(() => this.send(piece), i))
  }
}
