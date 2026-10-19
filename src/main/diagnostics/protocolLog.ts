/**
 * What the IMAP connections actually say to the server, with timings.
 *
 * The point of this is not the payload but the *waiting*: a slow refresh is almost never a
 * lot of data, it is a lot of round trips. Every entry therefore carries how long it came
 * after the previous entry of the same connection, which is the number that names the culprit.
 *
 * Nothing electron-specific lives here, so it can be tested directly.
 */

import type { ProtocolEntry, ProtocolSource } from '@peregrine/core/types'

/** Beyond this a line is a payload dump, and the interesting part is at the front. */
const MAX_TEXT_LENGTH = 400

/**
 * Removes credentials before they are ever held.
 *
 * imapflow and nodemailer both mask the values they know to be sensitive, but this log goes to
 * screen and to file, so it does not rely on somebody else's discretion.
 */
export function redactProtocolLine(text: string): string {
  return text
    .replace(/^(\S+\s+)?LOGIN\b.*/i, (_match, tag: string | undefined) => `${tag ?? ''}LOGIN (* hidden *)`)
    .replace(
      /^(\S+\s+)?AUTHENTICATE\s+(\S+).*/i,
      (_match, tag: string | undefined, mechanism: string) =>
        `${tag ?? ''}AUTHENTICATE ${mechanism} (* hidden *)`
    )
    .replace(
      /^AUTH\s+(\S+).*/i,
      (_match, mechanism: string) => `AUTH ${mechanism} (* hidden *)`
    )
}

/** A line that begins an authentication exchange, in either protocol. */
function opensAuthentication(text: string): boolean {
  return /^(\S+\s+)?(LOGIN|AUTHENTICATE|AUTH)\b/i.test(text)
}

/**
 * A server line asking for more rather than answering.
 *
 * `+` in IMAP, `334` in SMTP. Anything else concludes the exchange, whether it succeeded or not.
 */
function asksForMore(text: string): boolean {
  return /^\+/.test(text) || /^334\b/.test(text)
}

export function truncateProtocolLine(text: string): string {
  const collapsed = text.replace(/\r?\n/g, ' ').trim()
  if (collapsed.length <= MAX_TEXT_LENGTH) return collapsed
  return `${collapsed.slice(0, MAX_TEXT_LENGTH)}… [${collapsed.length} B]`
}

export class ProtocolLog {
  private entries: ProtocolEntry[] = []
  private lastAt = new Map<string, number>()
  private seq = 0

  /** Off by default: this holds server traffic in memory, which nobody asked for silently. */
  private recording = false
  /** Individual FETCH responses; they are the bulk and drown out the command flow. */
  private verbose = false
  /** Connections in the middle of an authentication exchange. */
  private authenticating = new Set<string>()

  constructor(private readonly capacity = 800) {}

  isRecording(): boolean {
    return this.recording
  }

  isVerbose(): boolean {
    return this.verbose
  }

  setRecording(recording: boolean): void {
    this.recording = recording
    // Starting a fresh recording with stale entries in view would make them look like they
    // belong to what is about to be reproduced.
    if (recording) this.clear()
  }

  setVerbose(verbose: boolean): void {
    this.verbose = verbose
  }

  record(connection: string, source: ProtocolSource, text: string, options?: { bulk?: boolean }): void {
    if (!this.recording) return
    if (options?.bulk && !this.verbose) return

    const at = Date.now()
    const previous = this.lastAt.get(connection)
    this.lastAt.set(connection, at)

    this.entries.push({
      seq: ++this.seq,
      at,
      deltaMs: previous == null ? 0 : at - previous,
      connection,
      source,
      text: truncateProtocolLine(this.redactInContext(connection, source, text))
    })
    if (this.entries.length > this.capacity) {
      this.entries.splice(0, this.entries.length - this.capacity)
    }
  }

  /**
   * Redaction that remembers where in the conversation the line sits.
   *
   * SASL does not put the credentials on the command line. The client says `AUTHENTICATE PLAIN`
   * or `AUTH LOGIN`, the server asks for more, and the password arrives on a line of its own
   * that is nothing but base64. Judged one line at a time it matches no command and reads as
   * ordinary traffic, which is exactly how it used to be written to the log in full.
   *
   * So every client line is dropped from the moment an authentication begins until the server
   * stops asking for more. Over-dropping is the safe direction here: a diagnostics log is worth
   * less than a password.
   */
  private redactInContext(connection: string, source: ProtocolSource, text: string): string {
    if (source === 'client') {
      if (this.authenticating.has(connection)) return '(* hidden *)'
      if (opensAuthentication(text)) this.authenticating.add(connection)
      return redactProtocolLine(text)
    }
    if (source === 'server' && this.authenticating.has(connection) && !asksForMore(text)) {
      this.authenticating.delete(connection)
    }
    return redactProtocolLine(text)
  }

  list(): ProtocolEntry[] {
    return [...this.entries]
  }

  clear(): void {
    this.entries = []
    this.lastAt.clear()
    // A connection left mid-authentication would otherwise keep hiding its lines forever, and
    // a recording that starts in the middle of one has no idea where it is either.
    this.authenticating.clear()
  }
}

/** The log the running connections write to. */
export const protocolLog = new ProtocolLog()

interface ImapLogRecord {
  src?: string
  msg?: string
  err?: { message?: string }
  cid?: string
}

/**
 * The logger object ImapFlow expects, wired to the ring buffer.
 *
 * It is always installed, not only while recording: imapflow builds the log string either
 * way, so handing it over costs nothing, and a diagnosis that needs a reconnect to start
 * would miss exactly the connection problems it is meant to catch.
 */
export interface ImapLogger {
  trace: (entry: ImapLogRecord) => void
  debug: (entry: ImapLogRecord) => void
  info: (entry: ImapLogRecord) => void
  warn: (entry: ImapLogRecord) => void
  error: (entry: ImapLogRecord) => void
  fatal: (entry: ImapLogRecord) => void
}

export function createImapLogger(connection: string): ImapLogger {
  const write = (source: ProtocolSource, bulk: boolean) => (entry: ImapLogRecord): void => {
    if (!entry || typeof entry !== 'object') return
    const text = entry.msg ?? entry.err?.message
    if (!text) return
    protocolLog.record(connection, entry.src === 'c' ? 'client' : entry.src === 's' ? 'server' : source, text, {
      bulk
    })
  }

  return {
    // imapflow sends the individual FETCH responses at trace level. The flood.
    trace: write('server', true),
    debug: write('info', false),
    info: write('info', false),
    warn: write('info', false),
    error: write('error', false),
    fatal: write('error', false)
  }
}

type NodemailerLogFn = (...params: unknown[]) => void

export interface SmtpLogger {
  level: NodemailerLogFn
  trace: NodemailerLogFn
  debug: NodemailerLogFn
  info: NodemailerLogFn
  warn: NodemailerLogFn
  error: NodemailerLogFn
  fatal: NodemailerLogFn
}

/**
 * The same buffer, filled from nodemailer.
 *
 * It reports differently from imapflow: a data object plus a printf-style message. The
 * placeholders are filled in here, because "%s" in a diagnostics log explains nothing.
 */
export function createSmtpLogger(connection: string): SmtpLogger {
  const write = (source: ProtocolSource) => (...params: unknown[]): void => {
    const data = params[0] as { tnx?: string } | undefined
    const message = typeof params[1] === 'string' ? params[1] : undefined
    const args = params.slice(2)
    if (!message) return
    let index = 0
    const text = message.replace(/%[sdj]/g, () => String(args[index++] ?? ''))
    protocolLog.record(
      connection,
      data?.tnx === 'server' ? 'server' : data?.tnx === 'client' ? 'client' : source,
      text
    )
  }

  return {
    // nodemailer sets the level through the logger itself; nothing here reacts to it.
    level: () => undefined,
    trace: write('info'),
    debug: write('info'),
    info: write('info'),
    warn: write('info'),
    error: write('error'),
    fatal: write('error')
  }
}
