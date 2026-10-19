import type { Transport, TransportConnectOptions } from '../src/transport'
import { decodeAscii } from '../src/utf8'
import { loadTranscript } from './fixtures'

const text = (bytes: Uint8Array): string => decodeAscii(bytes)
const bytesOf = (value: string): Uint8Array => Uint8Array.from(value, (c) => c.charCodeAt(0))
const CRLF = '\r\n'

export interface Received {
  tag: string
  verb: string
  /** The rest of the command line, with each literal shown as `<literal:N>`. */
  args: string
  /** The content of the literals the command carried. */
  literals: Uint8Array[]
  /** The line as received, for tests that care about spacing. */
  line: string
}

export type Handler = (command: Received) => string | null | Promise<string | null>

interface Pending {
  tag: string
  verb: string
  args: string
  line: string
  literals: Uint8Array[]
  waiting: number
}

/**
 * A server the tests can script, speaking just enough IMAP to be talked to.
 *
 * It parses commands the way a server does, literals included, and hands each to a handler that
 * answers with whatever text the test wants sent. That makes it possible to test the client's side
 * of things that a real server rarely does: refusing STARTTLS, answering NO where a literal was
 * expected, going quiet, or sending an update at a moment of its choosing. For everything a real
 * server does, `replay` plays back what Dovecot actually sent, with the tag changed to match.
 */
export class FakeServer {
  readonly received: Received[] = []
  readonly transport: Transport
  tlsStarted = false
  tlsFails = false
  /** Answers a command that announces a literal with this instead of asking for it. */
  refuseLiterals: ((tag: string) => string) | null = null
  closed = false
  connectedWith: TransportConnectOptions | null = null
  /** Lines the client wrote that were not commands: the DONE that ends IDLE. */
  readonly raw: string[] = []

  private handlers = new Map<string, Handler>()
  private onData: (bytes: Uint8Array) => void = () => undefined
  private onClose: (error?: Error) => void = () => undefined
  private buffer = ''
  private pending: Pending | null = null
  private idleTag: string | null = null

  constructor(
    private greeting = '* OK [CAPABILITY IMAP4rev1 IDLE UIDPLUS MOVE AUTH=PLAIN SASL-IR LITERAL+] ready\r\n'
  ) {
    this.transport = {
      connect: async (options) => {
        this.connectedWith = options
        if (this.greeting) setTimeout(() => this.send(this.greeting), 0)
      },
      startTls: async () => {
        if (this.tlsFails) throw new Error('certificate verify failed')
        this.tlsStarted = true
      },
      write: async (bytes) => {
        this.feed(text(bytes))
      },
      close: () => {
        if (this.closed) return
        this.closed = true
        setTimeout(() => this.onClose(), 0)
      },
      onData: (listener) => {
        this.onData = listener
      },
      onClose: (listener) => {
        this.onClose = listener
      }
    }
  }

  /** What to do with a command. The verb is upper case, and `UID` is part of it: `UID FETCH`. */
  on(verb: string, handler: Handler): this {
    this.handlers.set(verb.toUpperCase(), handler)
    return this
  }

  /** Sends text to the client, as if the server had said it unasked. */
  send(data: string): void {
    setTimeout(() => this.onData(bytesOf(data)), 0)
  }

  /** The server hangs up. */
  hangUp(error?: Error): void {
    this.closed = true
    setTimeout(() => this.onClose(error), 0)
  }

  /** The commands received so far as `VERB args`, without tags. */
  get commands(): string[] {
    return this.received.map((c) => `${c.verb} ${c.args}`.trim())
  }

  /**
   * Plays back what a real server answered to the first command in a recording that starts with
   * `prefix`: every chunk it sent in reply, up to and including the tagged completion, with the
   * recorded tag replaced by the one in use.
   */
  replay(transcript: string, prefix: string, tag: string): string {
    const exchanges = loadTranscript(transcript)
    const isCommand = (e: { direction: string; bytes: Uint8Array }): boolean =>
      e.direction === 'C' && /^A\d+ /.test(text(e.bytes))
    const at = exchanges.findIndex(
      (e) => isCommand(e) && text(e.bytes).replace(/^A\d+ /, '').startsWith(prefix)
    )
    if (at === -1) throw new Error(`No command starting with ${prefix} in ${transcript}`)
    const recordedTag = text(exchanges[at].bytes).split(' ')[0]
    const completion = new RegExp(`(^|\\r\\n)${recordedTag} (OK|NO|BAD)`)

    let out = ''
    for (const exchange of exchanges.slice(at + 1)) {
      // The literal after an APPEND is the client's, not a new command.
      if (exchange.direction === 'C') {
        if (isCommand(exchange)) break
        continue
      }
      out += text(exchange.bytes)
      if (completion.test(out)) break
    }
    return out.replace(new RegExp(`(^|\\r\\n)${recordedTag} (OK|NO|BAD)`, 'g'), `$1${tag} $2`)
  }

  static ok(tag: string, message = 'done'): string {
    return `${tag} OK ${message}${CRLF}`
  }

  // -- parsing the client's side ---------------------------------------------------------------

  private feed(data: string): void {
    this.buffer += data
    for (;;) {
      // The bytes of a literal come first, by count, whatever they look like. What is left of the
      // command line follows them.
      if (this.pending && this.pending.waiting > 0) {
        if (this.buffer.length < this.pending.waiting) return
        this.pending.literals.push(bytesOf(this.buffer.slice(0, this.pending.waiting)))
        this.buffer = this.buffer.slice(this.pending.waiting)
        this.pending.waiting = 0
      }

      const end = this.buffer.indexOf(CRLF)
      if (end === -1) return
      const line = this.buffer.slice(0, end)
      this.buffer = this.buffer.slice(end + 2)

      if (this.idleTag && line === 'DONE') {
        this.raw.push('DONE')
        const tag = this.idleTag
        this.idleTag = null
        this.send(`${tag} OK IDLE terminated${CRLF}`)
        continue
      }

      if (!this.pending) {
        const match = /^(\S+) (\S+)(?: (.*))?$/.exec(line)
        if (!match) {
          this.raw.push(line)
          continue
        }
        this.pending = {
          tag: match[1],
          verb: match[2].toUpperCase(),
          args: match[3] ?? '',
          line,
          literals: [],
          waiting: 0
        }
      } else {
        this.pending.args += line
        this.pending.line += line
      }

      const literal = /\{(\d+)(\+?)\}$/.exec(this.pending.args)
      if (literal) {
        this.pending.args = this.pending.args.replace(/\{\d+\+?\}$/, `<literal:${literal[1]}>`)
        this.pending.waiting = Number(literal[1])
        if (literal[2] !== '+') {
          if (this.refuseLiterals) {
            // A server that says no where it was asked to say go ahead. The client must not send
            // the literal anyway, and anything it does send lands in `raw`.
            this.send(this.refuseLiterals(this.pending.tag))
            this.pending = null
            continue
          }
          this.send(`+ ready for literal${CRLF}`)
        }
        continue
      }
      this.dispatch()
    }
  }

  private dispatch(): void {
    const command = this.pending
    this.pending = null
    if (!command) return
    const received: Received = {
      tag: command.tag,
      verb: command.verb,
      args: command.args.trim(),
      literals: command.literals,
      line: command.line
    }

    let key = received.verb
    if (key === 'UID') {
      const sub = received.args.split(' ')[0].toUpperCase()
      key = `UID ${sub}`
      received.verb = key
      received.args = received.args.slice(sub.length).trim()
    }
    this.received.push(received)

    const handler = this.handlers.get(key)
    if (!handler) {
      this.send(`${received.tag} BAD no handler for ${key}${CRLF}`)
      return
    }
    void Promise.resolve(handler(received)).then((reply) => {
      if (reply === null) return
      if (key === 'IDLE') this.idleTag = received.tag
      this.send(reply)
    })
  }
}
