import { isAnswer, isLiteral, mailbox, type Arg } from './commands'
import {
  parseResponse,
  ProtocolError,
  ResponseReader,
  tokenText,
  type ResponseCode,
  type ServerMessage,
  type StatusKind
} from './protocol'
import type { Transport, TransportConnectOptions } from './transport'
import { decodeAscii } from './utf8'

/**
 * The conversation with a server: commands go out one at a time, answers are matched to them, and
 * what the server says unasked is kept track of.
 *
 * It does not know what any command means. That is the session's business. What it does know is
 * the mechanics every command shares: tags, the handshake a literal needs, the state of the
 * selected mailbox, IDLE, and what to do when the other side goes quiet.
 */

export interface LogEvent {
  direction: 'C' | 'S'
  text: string
}

export interface ClientOptions {
  /** Called for every line sent and received. Secrets are masked before they get here. */
  log?: (event: LogEvent) => void
  /** How long the server may take to greet. */
  greetingTimeoutMs?: number
  /** How long a command may go without any sign of life from the server. */
  inactivityTimeoutMs?: number
}

export interface SelectedMailbox {
  path: string
  exists: number
  uidValidity: bigint
  uidNext: number
  flags: string[]
  permanentFlags: string[]
  readOnly: boolean
}

export interface CommandResult {
  code: ResponseCode | null
  text: string
  /** Everything the server sent untagged while the command ran. */
  data: ServerMessage[]
}

export class ImapError extends Error {
  constructor(
    readonly status: StatusKind,
    readonly code: ResponseCode | null,
    readonly text: string,
    readonly command: string
  ) {
    super(text || status)
    this.name = 'ImapError'
  }
}

interface Job {
  kind: 'command' | 'idle'
  tag: string
  parts: Arg[]
  redact: boolean
  data: ServerMessage[]
  resolve: (result: CommandResult) => void
  reject: (error: Error) => void
  /** Set while waiting for the server's `+`. Called with false if the command ends first. */
  continuation: ((granted: boolean) => void) | null
  doneSent: boolean
  /** For IDLE: ending was asked for before the server said it was listening. */
  stopRequested: boolean
  /** For IDLE: called once the server has said it is listening. */
  started: ((started: boolean) => void) | null
}

const CRLF = String.fromCharCode(13, 10)
const DEFAULT_GREETING_TIMEOUT_MS = 16_000
const DEFAULT_INACTIVITY_TIMEOUT_MS = 5 * 60_000
/** Above this a literal is announced with `{n}` and waited for, even when `LITERAL-` allows more. */
const SMALL_LITERAL = 4096

export class ImapClient {
  capabilities = new Set<string>()
  selected: SelectedMailbox | null = null

  private reader = new ResponseReader()
  private queue: Job[] = []
  private current: Job | null = null
  private counter = 0
  private closed = false
  private idling = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private pendingSelect: SelectedMailbox | null = null
  private greeting: { resolve: (m: ServerMessage) => void; reject: (e: Error) => void } | null = null
  private unsolicited: ((message: ServerMessage) => void)[] = []
  private closeListeners: ((error?: Error) => void)[] = []
  private errorListeners: ((error: Error) => void)[] = []
  private readonly greetingTimeoutMs: number
  private readonly inactivityTimeoutMs: number

  constructor(
    private readonly transport: Transport,
    private readonly options: ClientOptions = {}
  ) {
    this.greetingTimeoutMs = options.greetingTimeoutMs ?? DEFAULT_GREETING_TIMEOUT_MS
    this.inactivityTimeoutMs = options.inactivityTimeoutMs ?? DEFAULT_INACTIVITY_TIMEOUT_MS
    transport.onData((bytes) => this.receive(bytes))
    transport.onClose((error) => this.ended(error))
  }

  onUnsolicited(listener: (message: ServerMessage) => void): void {
    this.unsolicited.push(listener)
  }

  onClose(listener: (error?: Error) => void): void {
    this.closeListeners.push(listener)
  }

  onError(listener: (error: Error) => void): void {
    this.errorListeners.push(listener)
  }

  get isIdling(): boolean {
    return this.idling
  }

  get isClosed(): boolean {
    return this.closed
  }

  /** Opens the connection and returns the server's greeting. */
  async connect(options: TransportConnectOptions): Promise<ServerMessage> {
    // Registered before the connection exists, because with implicit TLS the greeting can arrive
    // in the same breath as the handshake finishing.
    const greeting = new Promise<ServerMessage>((resolve, reject) => {
      this.greeting = { resolve, reject }
    })
    greeting.catch(() => undefined)
    await this.transport.connect(options)
    const timeout = setTimeout(() => {
      this.fail(new Error('The server did not greet in time'))
    }, this.greetingTimeoutMs)
    try {
      const message = await greeting
      if (message.kind === 'status' && message.status === 'BYE') {
        throw new ImapError('BYE', message.code, message.text, 'greeting')
      }
      return message
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * Upgrades to TLS after the server has agreed to STARTTLS. Everything learned before is
   * forgotten: what the server offers may differ once the line is encrypted, and a capability list
   * read in the clear is exactly what an attacker on the path could have edited.
   */
  async startTls(host: string): Promise<void> {
    this.reader = new ResponseReader()
    this.capabilities = new Set()
    await this.transport.startTls(host)
  }

  /** Runs a command and resolves when the server has answered it. NO and BAD are errors. */
  command(parts: Arg[], options: { redact?: boolean } = {}): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(new Error('The connection is closed'))
        return
      }
      this.queue.push({
        kind: 'command',
        tag: `A${++this.counter}`,
        parts,
        redact: options.redact ?? false,
        data: [],
        resolve,
        reject,
        continuation: null,
        doneSent: false,
        stopRequested: false,
        started: null
      })
      this.pump()
    })
  }

  /** Selects a mailbox, and keeps what the server says about it. */
  async select(path: string): Promise<SelectedMailbox> {
    // A SELECT that fails leaves nothing selected, whatever was open before.
    this.selected = null
    const pending: SelectedMailbox = {
      path,
      exists: 0,
      uidValidity: 0n,
      uidNext: 0,
      flags: [],
      permanentFlags: [],
      readOnly: false
    }
    this.pendingSelect = pending
    try {
      const result = await this.command(['SELECT', mailbox(path)])
      pending.readOnly = result.code?.name === 'READ-ONLY'
      this.selected = pending
      return pending
    } finally {
      this.pendingSelect = null
    }
  }

  /**
   * Starts IDLE. Returns false when it cannot be started right now: the server does not offer it,
   * or the connection is busy, which is the better reason not to.
   */
  startIdle(): Promise<boolean> {
    if (this.closed || !this.capabilities.has('IDLE') || this.current || this.queue.length > 0) {
      return Promise.resolve(false)
    }
    return new Promise((resolve) => {
      const job: Job = {
        kind: 'idle',
        tag: `A${++this.counter}`,
        parts: ['IDLE'],
        redact: false,
        data: [],
        resolve: () => undefined,
        reject: () => resolve(false),
        continuation: null,
        doneSent: false,
        stopRequested: false,
        started: resolve
      }
      this.queue.push(job)
      this.pump()
    })
  }

  /** Ends IDLE if it is running, and resolves once the server has confirmed. */
  async stopIdle(): Promise<void> {
    const job = this.current
    if (!job || job.kind !== 'idle') return
    const finished = new Promise<void>((resolve) => {
      const { resolve: previous, reject: previousReject } = job
      job.resolve = (result) => {
        previous(result)
        resolve()
      }
      job.reject = (error) => {
        previousReject(error)
        resolve()
      }
    })
    if (this.idling) this.sendDone(job)
    else job.stopRequested = true
    await finished
  }

  /** Closes the connection at once. */
  close(): void {
    this.transport.close()
  }

  // -- sending ---------------------------------------------------------------------------------

  private pump(): void {
    if (this.current) {
      if (this.current.kind === 'idle' && this.queue.length > 0) {
        // Not before the server has said it is listening: DONE is only meaningful to IDLE.
        if (this.idling) this.sendDone(this.current)
        else this.current.stopRequested = true
      }
      return
    }
    const job = this.queue.shift()
    if (!job) return
    this.current = job
    this.touch()
    void this.send(job).catch((error: unknown) => {
      this.fail(error instanceof Error ? error : new Error(String(error)))
    })
  }

  private sendDone(job: Job): void {
    if (job.doneSent) return
    job.doneSent = true
    void this.write('DONE\r\n', 'DONE').catch((error: unknown) => {
      this.fail(error instanceof Error ? error : new Error(String(error)))
    })
  }

  private async send(job: Job): Promise<void> {
    let out = job.tag
    for (const part of job.parts) {
      if (typeof part === 'string') {
        out += ' ' + part
      } else if (isLiteral(part)) {
        const size = part.literal.length
        const nonSynchronizing =
          this.capabilities.has('LITERAL+') || (this.capabilities.has('LITERAL-') && size <= SMALL_LITERAL)
        out += ` {${size}${nonSynchronizing ? '+' : ''}}${CRLF}`
        // Waiting is arranged before the line goes out. A transport that answers at once must not
        // find nobody listening.
        const granted = nonSynchronizing ? null : this.expectContinuation(job)
        await this.write(out, job.redact ? `${job.tag} *** {${size}}` : out.trimEnd())
        out = ''
        if (granted && !(await granted)) return
        await this.transport.write(part.literal)
        this.options.log?.({ direction: 'C', text: `[${size} bytes]` })
      } else if (isAnswer(part)) {
        const granted = this.expectContinuation(job)
        await this.write(out + CRLF, job.redact ? `${job.tag} ***` : out)
        if (!(await granted)) return
        out = part.answer
      }
    }

    const granted = job.kind === 'idle' ? this.expectContinuation(job) : null
    const visible = job.redact ? `${job.tag} ${redactedName(job.parts)} ***` : out
    await this.write(out + CRLF, visible)

    if (granted) {
      // The server's `+` is the sign it is listening. Until then nothing may be sent.
      if (await granted) {
        this.idling = true
        this.clearTimer()
        job.started?.(true)
        if (job.stopRequested) this.sendDone(job)
      }
    }
  }

  private expectContinuation(job: Job): Promise<boolean> {
    return new Promise((resolve) => {
      job.continuation = resolve
    })
  }

  private async write(text: string, loggable: string): Promise<void> {
    this.options.log?.({ direction: 'C', text: loggable })
    const bytes = new Uint8Array(text.length)
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff
    await this.transport.write(bytes)
  }

  // -- receiving -------------------------------------------------------------------------------

  private receive(bytes: Uint8Array): void {
    this.touch()
    let responses: Uint8Array[]
    try {
      responses = this.reader.push(bytes)
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)))
      return
    }
    for (const raw of responses) {
      let message: ServerMessage
      try {
        message = parseResponse(raw)
      } catch (error) {
        this.fail(error instanceof Error ? error : new ProtocolError(String(error)))
        return
      }
      this.options.log?.({ direction: 'S', text: summary(raw) })
      this.handle(message)
    }
  }

  private handle(message: ServerMessage): void {
    if (message.kind === 'continuation') {
      const job = this.current
      if (job?.continuation) {
        const granted = job.continuation
        job.continuation = null
        granted(true)
      }
      return
    }

    if (message.kind === 'status' && message.tag !== null) {
      this.completed(message)
      return
    }

    if (this.greeting && message.kind === 'status') {
      const waiting = this.greeting
      this.greeting = null
      this.noteState(message)
      waiting.resolve(message)
      return
    }

    this.noteState(message)
    this.current?.data.push(message)
    for (const listener of this.unsolicited) listener(message)
  }

  private completed(message: Extract<ServerMessage, { kind: 'status' }>): void {
    const job = this.current
    if (!job || job.tag !== message.tag) return
    this.current = null
    this.idling = false
    this.clearTimer()
    this.noteState(message)

    // A command that ends before the server asked for its literal never sends the literal.
    if (job.continuation) {
      const waiting = job.continuation
      job.continuation = null
      waiting(false)
    }
    job.started?.(false)

    if (message.status === 'OK') {
      job.resolve({ code: message.code, text: message.text, data: job.data })
    } else {
      job.reject(new ImapError(message.status, message.code, message.text, commandName(job.parts)))
    }
    this.pump()
  }

  /** What the server says about the connection and the selected mailbox, whenever it says it. */
  private noteState(message: ServerMessage): void {
    const target = this.pendingSelect ?? this.selected

    if (message.kind === 'data') {
      switch (message.name) {
        case 'CAPABILITY':
          this.capabilities = new Set(message.tokens.map((t) => tokenText(t).toUpperCase()))
          break
        case 'EXISTS':
          if (target && message.number !== null) target.exists = message.number
          break
        case 'EXPUNGE':
          if (target && target.exists > 0) target.exists--
          break
        case 'FLAGS':
          if (target && message.tokens[0]?.type === 'list') {
            target.flags = message.tokens[0].items.map(tokenText)
          }
          break
      }
      return
    }

    if (message.kind !== 'status' || !message.code) return
    const { name, args } = message.code
    switch (name) {
      case 'CAPABILITY':
        this.capabilities = new Set(args.map((t) => tokenText(t).toUpperCase()))
        break
      case 'UIDVALIDITY':
        if (target && args[0]?.type === 'number') target.uidValidity = BigInt(args[0].value)
        break
      case 'UIDNEXT':
        if (target && args[0]?.type === 'number') target.uidNext = args[0].value
        break
      case 'PERMANENTFLAGS':
        if (target && args[0]?.type === 'list') target.permanentFlags = args[0].items.map(tokenText)
        break
    }
  }

  // -- keeping watch ---------------------------------------------------------------------------

  /** Sign of life: the clock for the command in progress starts again. */
  private touch(): void {
    this.clearTimer()
    if (!this.current || this.idling) return
    this.timer = setTimeout(() => {
      this.fail(new Error('The server stopped answering'))
    }, this.inactivityTimeoutMs)
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  /** The connection is no good any more: tell everyone waiting, and close it. */
  private fail(error: Error): void {
    if (this.closed) return
    for (const listener of this.errorListeners) listener(error)
    // The reason is recorded first. Closing may report the close straight away, without one.
    this.ended(error)
    this.transport.close()
  }

  private ended(error?: Error): void {
    if (this.closed) return
    this.closed = true
    this.idling = false
    this.clearTimer()
    const reason = error ?? new Error('The connection was closed')
    this.greeting?.reject(reason)
    this.greeting = null
    const waiting = [...(this.current ? [this.current] : []), ...this.queue]
    this.current = null
    this.queue = []
    for (const job of waiting) {
      if (job.continuation) job.continuation(false)
      job.started?.(false)
      job.reject(reason)
    }
    for (const listener of this.closeListeners) listener(error)
  }
}

function commandName(parts: Arg[]): string {
  const first = parts[0]
  return typeof first === 'string' ? first : 'command'
}

/** Name of the command for the log, with the secret behind it left out. */
function redactedName(parts: Arg[]): string {
  const first = parts[0]
  return typeof first === 'string' ? first : ''
}

function summary(raw: Uint8Array): string {
  const limit = 2000
  const text = decodeAscii(raw, 0, Math.min(raw.length, limit)).replace(/\r?\n$/, '')
  return raw.length > limit ? `${text} [… ${raw.length - limit} more bytes]` : text
}
