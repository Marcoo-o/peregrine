import { appError } from '@peregrine/core/errorText'
import type {
  FetchedMessage,
  FullMessage,
  ImapSession,
  ImapSessionOptions,
  MailboxEntry,
  MailboxStatus,
  SyncFetchResult
} from '@peregrine/core/imapSession'
import { ImapClient, ImapError, type ClientOptions, type CommandResult } from './client'
import {
  astring,
  expandSequenceSet,
  flagList,
  literal,
  mailbox,
  sequenceSet,
  type Arg
} from './commands'
import { parseFetch } from './fetch'
import { encodeBase64 } from './mime'
import { tokenText, type ServerMessage, type Token } from './protocol'
import type { Transport } from './transport'
import { encodeUtf8 } from './utf8'
import { decodeMailboxName } from './utf7'

/**
 * `ImapSession` over a connection this package speaks itself.
 *
 * Each method is a short sequence of commands. The part that is not short is keeping the
 * sequences from getting in each other's way: a connection has one selected mailbox, so two
 * operations on two mailboxes must not interleave, and the connection should rest on the inbox
 * between them so that IDLE reports arrivals there.
 */

export interface ClientSessionDependencies extends ClientOptions {
  transport: Transport
  /** How long after the last operation the connection returns to the mailbox it watches. */
  parkDelayMs?: number
  /** How often IDLE is renewed. */
  idleRenewalMs?: number
  /** How long a farewell may take before the connection is simply closed. */
  logoutTimeoutMs?: number
}

const PARK_DELAY_MS = 2000
// The standard allows a server to drop an IDLE after 30 minutes.
const IDLE_RENEWAL_MS = 29 * 60_000
const LOGOUT_TIMEOUT_MS = 3000

const SPECIAL_USE: Record<string, string> = {
  '\\all': '\\All',
  '\\archive': '\\Archive',
  '\\drafts': '\\Drafts',
  '\\flagged': '\\Flagged',
  '\\junk': '\\Junk',
  '\\sent': '\\Sent',
  '\\trash': '\\Trash',
  '\\important': '\\Important'
}

class Queue {
  private tail: Promise<unknown> = Promise.resolve()

  run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work, work)
    this.tail = result.catch(() => undefined)
    return result
  }
}

export function toMailboxEntry(tokens: Token[]): MailboxEntry | null {
  const [attributes, delimiterToken, nameToken] = tokens
  if (!attributes || attributes.type !== 'list' || !nameToken) return null
  const delimiter = delimiterToken?.type === 'string' ? tokenText(delimiterToken) : ''
  const path = decodeMailboxName(tokenText(nameToken))
  const flags = attributes.items.map(tokenText)
  const role = flags.map((f) => SPECIAL_USE[f.toLowerCase()]).find((value) => value !== undefined)
  return {
    path,
    name: delimiter ? (path.split(delimiter).pop() ?? path) : path,
    parentPath: delimiter && path.includes(delimiter) ? path.slice(0, path.lastIndexOf(delimiter)) : null,
    flags,
    specialUse: role ?? (path.toUpperCase() === 'INBOX' ? '\\Inbox' : null)
  }
}

/** A message of a folder as a sync has it, from what the server said of it, or nothing for an answer that does not name a UID. */
function fetchedMessage(data: ReturnType<typeof parseFetch>): FetchedMessage | undefined {
  if (data.uid === undefined) return undefined
  const envelope = data.envelope
  return {
    uid: data.uid,
    flags: storedFlags(data.flags),
    size: data.size ?? 0,
    envelope: {
      subject: envelope?.subject ?? undefined,
      messageId: envelope?.messageId ?? undefined,
      inReplyTo: envelope?.inReplyTo ?? undefined,
      date: validDate(envelope?.date ?? null),
      from: envelope?.from,
      to: envelope?.to,
      cc: envelope?.cc,
      bcc: envelope?.bcc
    },
    hasAttachment: data.bodyStructure?.childNodes?.some((node) => node.disposition === 'attachment') ?? false
  }
}

function dataOf(result: CommandResult, name: string): ServerMessage[] {
  return result.data.filter((m) => m.kind === 'data' && m.name === name)
}

/**
 * The flags worth keeping. `\Recent` says that this connection is the first to see a message, and
 * the server tells that to one connection only. It is not part of the message, cannot be changed,
 * and stored it would show up on the first sync and be gone from the next, writing an update for
 * every message on the way.
 */
function storedFlags(flags: string[] | undefined): string[] {
  return (flags ?? []).filter((flag) => flag.toLowerCase() !== '\\recent')
}

function validDate(text: string | null): Date | undefined {
  if (!text) return undefined
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? undefined : date
}

/** The UIDs a COPYUID code maps, source to target, or null when the server did not say. */
function copyUidMap(result: CommandResult): Map<number, number> | null {
  const codes = [
    result.code,
    ...result.data.map((m) => (m.kind === 'status' ? m.code : null))
  ]
  const code = codes.find((c) => c?.name === 'COPYUID')
  if (!code || code.args.length < 3) return null
  try {
    const from = expandSequenceSet(tokenText(code.args[1]))
    const to = expandSequenceSet(tokenText(code.args[2]))
    if (from.length !== to.length) return null
    const map = new Map<number, number>()
    from.forEach((uid, index) => map.set(uid, to[index]))
    return map.size > 0 ? map : null
  } catch {
    return null
  }
}

export class ImapClientSession implements ImapSession {
  private readonly client: ImapClient
  private readonly queue = new Queue()
  private parkPath: string | null = null
  private parkTimer: ReturnType<typeof setTimeout> | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private watchedCount: number | null = null
  private stopped = false
  private readonly parkDelayMs: number
  private readonly idleRenewalMs: number
  private readonly logoutTimeoutMs: number

  constructor(
    private readonly options: ImapSessionOptions,
    dependencies: ClientSessionDependencies
  ) {
    this.client = new ImapClient(dependencies.transport, dependencies)
    this.parkDelayMs = dependencies.parkDelayMs ?? PARK_DELAY_MS
    this.idleRenewalMs = dependencies.idleRenewalMs ?? IDLE_RENEWAL_MS
    this.logoutTimeoutMs = dependencies.logoutTimeoutMs ?? LOGOUT_TIMEOUT_MS
  }

  // -- connection ------------------------------------------------------------------------------

  async connect(): Promise<void> {
    const { host, port, secure } = this.options
    const greeting = await this.client.connect({ host, port, tls: secure === 'tls' })
    const preauthenticated = greeting.kind === 'status' && greeting.status === 'PREAUTH'
    if (this.client.capabilities.size === 0) await this.client.command(['CAPABILITY'])

    if (secure === 'starttls') {
      // STARTTLS or nothing. A server that does not offer it, or refuses it, is not given the
      // password in the clear because the user asked for encryption.
      if (!this.client.capabilities.has('STARTTLS')) {
        throw new Error('The server does not offer STARTTLS, which this account requires')
      }
      await this.upgrade()
    } else if (secure === 'none' && this.client.capabilities.has('STARTTLS')) {
      // Deliberately unencrypted, but an upgrade that is on offer is still better than none.
      try {
        await this.upgrade()
      } catch (error) {
        if (!(error instanceof ImapError)) throw error
      }
    }

    if (!preauthenticated) await this.authenticate()
  }

  /** Runs STARTTLS and switches the line to TLS. The capabilities are read again afterwards. */
  private async upgrade(): Promise<void> {
    await this.client.command(['STARTTLS'])
    await this.client.startTls(this.options.host)
    await this.client.command(['CAPABILITY'])
  }

  private async authenticate(): Promise<void> {
    const { username, password } = this.options
    const capabilities = this.client.capabilities
    let result: CommandResult

    if (capabilities.has('AUTH=PLAIN')) {
      const initial = encodeBase64(encodeUtf8(`\u0000${username}\u0000${password}`))
      result = await this.client.command(
        capabilities.has('SASL-IR')
          ? ['AUTHENTICATE', 'PLAIN', initial]
          : ['AUTHENTICATE', 'PLAIN', { answer: initial }],
        { redact: true }
      )
    } else if (!capabilities.has('LOGINDISABLED')) {
      result = await this.client.command(['LOGIN', astring(username), astring(password)], {
        redact: true
      })
    } else {
      throw new Error('The server offers no way to log in over this connection')
    }

    // What the server can do usually changes with logging in. It often says so in the answer, and
    // when it does not, it has to be asked.
    const said =
      result.code?.name === 'CAPABILITY' || result.data.some((m) => m.kind === 'data' && m.name === 'CAPABILITY')
    if (!said) await this.client.command(['CAPABILITY'])
  }

  async disconnect(): Promise<void> {
    this.stopped = true
    this.clearTimers()
    try {
      await Promise.race([
        this.client.command(['LOGOUT']),
        new Promise<void>((resolve) => setTimeout(resolve, this.logoutTimeoutMs))
      ])
    } catch {
      // Closing is what matters, and it happens next either way.
    }
    this.client.close()
  }

  onClose(listener: () => void): void {
    this.client.onClose(() => listener())
  }

  onError(listener: (err: Error) => void): void {
    this.client.onError(listener)
  }

  // -- watching --------------------------------------------------------------------------------

  watchMailbox(imapPath: string, onArrival: () => void): void {
    this.parkPath = imapPath
    this.client.onUnsolicited((message) => {
      if (message.kind !== 'data' || this.client.selected?.path !== this.parkPath) return
      if (message.name === 'EXISTS' && message.number !== null) {
        // Only for growth: a message being deleted lowers the count, and another folder's fetch
        // reports its own.
        const grew = this.watchedCount !== null && message.number > this.watchedCount
        this.watchedCount = message.number
        if (grew) onArrival()
      } else if (message.name === 'EXPUNGE' && this.watchedCount !== null && this.watchedCount > 0) {
        this.watchedCount--
      }
    })
    void this.park()
  }

  private schedulePark(): void {
    if (!this.parkPath || this.stopped) return
    if (this.parkTimer !== null) clearTimeout(this.parkTimer)
    this.parkTimer = setTimeout(() => void this.park(), this.parkDelayMs)
  }

  /** Returns to the watched mailbox and listens there. */
  private park(): Promise<void> {
    return this.queue.run(async () => {
      const path = this.parkPath
      if (this.stopped || !path || this.client.isClosed) return
      try {
        if (this.client.selected?.path !== path) {
          const selected = await this.client.select(path)
          this.watchedCount = selected.exists
        }
        if (await this.client.startIdle()) this.scheduleIdleRenewal()
      } catch {
        // Not worth reporting. The next command selects again, and a connection that cannot
        // select its inbox has larger problems that show up elsewhere.
      }
    })
  }

  private scheduleIdleRenewal(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => {
      void this.queue.run(async () => {
        if (this.stopped || this.client.isClosed) return
        await this.client.stopIdle()
        if (await this.client.startIdle()) this.scheduleIdleRenewal()
      })
    }, this.idleRenewalMs)
  }

  private clearTimers(): void {
    if (this.parkTimer !== null) clearTimeout(this.parkTimer)
    if (this.idleTimer !== null) clearTimeout(this.idleTimer)
    this.parkTimer = null
    this.idleTimer = null
  }

  // -- operations ------------------------------------------------------------------------------

  /**
   * Runs `work` with `imapPath` selected, alone on the connection, and arranges for the connection
   * to return to the watched mailbox afterwards. Every operation that needs a mailbox goes
   * through here so that no caller has to remember.
   */
  private withMailbox<T>(
    imapPath: string,
    work: (selected: NonNullable<ImapClient['selected']>, justSelected: boolean) => Promise<T>
  ): Promise<T> {
    return this.queue.run(async () => {
      try {
        let selected = this.client.selected
        let justSelected = false
        if (!selected || selected.path !== imapPath) {
          try {
            selected = await this.client.select(imapPath)
          } catch (error) {
            if (error instanceof ImapError) throw appError('mailboxOpenFailed', imapPath)
            throw error
          }
          justSelected = true
          if (imapPath === this.parkPath) this.watchedCount = selected.exists
        }
        return await work(selected, justSelected)
      } finally {
        this.schedulePark()
      }
    })
  }

  /**
   * Brings the picture of the open mailbox up to date.
   *
   * What other connections did to it is only reported at the next command, so a mailbox that has
   * been open for a while is behind. While IDLE runs the server says so as it happens. Otherwise a
   * NOOP asks, which is what it exists for. Operations that act on a UID do not need this. Those
   * that read the count or the list of messages do.
   */
  private async refresh(): Promise<void> {
    if (!this.client.isIdling) await this.client.command(['NOOP'])
  }

  /** A command that needs no mailbox, alone on the connection. */
  private alone<T>(work: () => Promise<T>): Promise<T> {
    return this.queue.run(async () => {
      try {
        return await work()
      } finally {
        this.schedulePark()
      }
    })
  }

  async listMailboxes(): Promise<MailboxEntry[]> {
    return this.alone(async () => {
      const extended =
        this.client.capabilities.has('LIST-EXTENDED') && this.client.capabilities.has('SPECIAL-USE')
      const parts: Arg[] = extended
        ? ['LIST', '""', '"*"', 'RETURN', '(SPECIAL-USE)']
        : ['LIST', '""', '"*"']
      const result = await this.client.command(parts)
      const entries: MailboxEntry[] = []
      for (const message of dataOf(result, 'LIST')) {
        if (message.kind !== 'data') continue
        const entry = toMailboxEntry(message.tokens)
        if (entry) entries.push(entry)
      }
      return entries
    })
  }

  async mailboxStatus(imapPath: string): Promise<MailboxStatus> {
    return this.alone(async () => {
      // Asking about the mailbox that is already open is asking a question the connection knows
      // the answer to, and some servers object to it.
      const open = this.client.selected
      if (open && open.path === imapPath) {
        await this.refresh()
        return { uidValidity: open.uidValidity, uidNext: open.uidNext, messages: open.exists }
      }
      const result = await this.client.command([
        'STATUS',
        mailbox(imapPath),
        '(UIDNEXT UIDVALIDITY MESSAGES)'
      ])
      const status = dataOf(result, 'STATUS')[0]
      const list = status?.kind === 'data' ? status.tokens[1] : undefined
      const values = new Map<string, number>()
      if (list?.type === 'list') {
        for (let i = 0; i + 1 < list.items.length; i += 2) {
          const value = list.items[i + 1]
          if (value.type === 'number') values.set(tokenText(list.items[i]).toUpperCase(), value.value)
        }
      }
      return {
        uidValidity: BigInt(values.get('UIDVALIDITY') ?? 0),
        uidNext: values.get('UIDNEXT') ?? 0,
        messages: values.get('MESSAGES') ?? 0
      }
    })
  }

  async syncFetch(
    imapPath: string,
    decideRange: (status: { uidValidity: bigint; uidNext: number }) => string | Promise<string>
  ): Promise<SyncFetchResult> {
    return this.withMailbox(imapPath, async (selected, justSelected) => {
      if (!justSelected) await this.refresh()
      const status = { uidValidity: selected.uidValidity, uidNext: selected.uidNext }
      const range = await decideRange(status)

      const messages: FetchedMessage[] = []
      const flags: { uid: number; flags: string[] }[] = []
      // An empty mailbox has nothing to fetch, and a range such as `10:*` on one is an error to
      // some servers.
      if (selected.exists > 0) {
        const full = await this.client.command([
          'UID',
          'FETCH',
          rangeOf(range),
          '(UID FLAGS RFC822.SIZE ENVELOPE BODYSTRUCTURE)'
        ])
        for (const message of dataOf(full, 'FETCH')) {
          const fetched = fetchedMessage(parseFetch(message))
          if (fetched) messages.push(fetched)
        }

        // Flags of everything, without envelope or body structure: this is what tells the sync
        // which messages still exist and whether their read state changed elsewhere.
        const all = await this.client.command(['UID', 'FETCH', '1:*', '(UID FLAGS)'])
        for (const message of dataOf(all, 'FETCH')) {
          const data = parseFetch(message)
          if (data.uid !== undefined) flags.push({ uid: data.uid, flags: storedFlags(data.flags) })
        }
      }
      return { messages, flags, ...status }
    })
  }

  async fetchMessages(imapPath: string, uids: number[]): Promise<FetchedMessage[]> {
    if (uids.length === 0) return []
    // Built before anything is sent: a value that is not a UID is refused without the connection having done anything.
    const set = sequenceSet(uids)
    return this.withMailbox(imapPath, async (_selected, justSelected) => {
      if (!justSelected) await this.refresh()
      const result = await this.client.command(['UID', 'FETCH', set, '(UID FLAGS RFC822.SIZE ENVELOPE BODYSTRUCTURE)'])
      const messages: FetchedMessage[] = []
      for (const message of dataOf(result, 'FETCH')) {
        const fetched = fetchedMessage(parseFetch(message))
        if (fetched) messages.push(fetched)
      }
      return messages
    })
  }

  async fetchFullMessage(imapPath: string, uid: number): Promise<FullMessage | undefined> {
    // Built before anything is sent, here and in the methods below. A value that is not allowed
    // in a command is refused without the connection having done anything on its account.
    const set = sequenceSet([uid])
    const fetch = async (): Promise<FullMessage | undefined> => {
      const result = await this.client.command(['UID', 'FETCH', set, '(BODY.PEEK[])'])
      for (const message of dataOf(result, 'FETCH')) {
        const source = parseFetch(message).sections.get('BODY[]')
        if (source) return { source }
      }
      return undefined
    }
    return this.withMailbox(imapPath, async (_selected, justSelected) => {
      const found = await fetch()
      if (found || justSelected) return found
      // A mailbox that has been open for a while does not know the messages that came after it was
      // opened, and is silent about a UID it does not know. That is what a notification points at.
      // So it is brought up to date, and the answer is asked for once more before it is believed.
      await this.refresh()
      return fetch()
    })
  }

  private async store(
    imapPath: string,
    uids: number[],
    how: '' | '+' | '-',
    flags: string[]
  ): Promise<void> {
    const command: Arg[] = ['UID', 'STORE', sequenceSet(uids), `${how}FLAGS.SILENT`, flagList(flags)]
    await this.withMailbox(imapPath, async () => {
      await this.client.command(command)
    })
  }

  setFlags(imapPath: string, uid: number, flags: string[]): Promise<void> {
    return this.store(imapPath, [uid], '', flags)
  }

  addFlags(imapPath: string, uid: number, flags: string[]): Promise<void> {
    return this.store(imapPath, [uid], '+', flags)
  }

  removeFlags(imapPath: string, uid: number, flags: string[]): Promise<void> {
    return this.store(imapPath, [uid], '-', flags)
  }

  /** Removes what was flagged as deleted. Only the messages asked about, where the server allows. */
  private async expunge(set: string): Promise<void> {
    if (this.client.capabilities.has('UIDPLUS')) {
      await this.client.command(['UID', 'EXPUNGE', set])
    } else {
      // Without UIDPLUS there is no way to name the messages, and every message flagged deleted
      // in this mailbox goes, including ones flagged by somebody else.
      await this.client.command(['EXPUNGE'])
    }
  }

  async moveMessages(
    sourcePath: string,
    targetPath: string,
    uids: number[]
  ): Promise<Map<number, number> | null> {
    const set = sequenceSet(uids)
    const target = mailbox(targetPath)
    return this.withMailbox(sourcePath, async () => {
      if (this.client.capabilities.has('MOVE')) {
        return copyUidMap(await this.client.command(['UID', 'MOVE', set, target]))
      }
      const copied = await this.client.command(['UID', 'COPY', set, target])
      await this.client.command(['UID', 'STORE', set, '+FLAGS.SILENT', flagList(['\\Deleted'])])
      await this.expunge(set)
      return copyUidMap(copied)
    })
  }

  async deleteMessages(imapPath: string, uids: number[]): Promise<void> {
    const set = sequenceSet(uids)
    return this.withMailbox(imapPath, async () => {
      await this.client.command(['UID', 'STORE', set, '+FLAGS.SILENT', flagList(['\\Deleted'])])
      await this.expunge(set)
    })
  }

  async appendMessage(
    imapPath: string,
    rfc822Source: Uint8Array | string,
    flags: string[] = ['\\Seen']
  ): Promise<number | null> {
    return this.alone(async () => {
      const parts: Arg[] = ['APPEND', mailbox(imapPath)]
      if (flags.length > 0) parts.push(flagList(flags))
      parts.push(literal(rfc822Source))
      const result = await this.client.command(parts)
      const code = result.code?.name === 'APPENDUID' ? result.code : null
      const uid = code?.args[1]
      return uid?.type === 'number' ? uid.value : null
    })
  }

  createMailbox(path: string): Promise<void> {
    return this.alone(async () => {
      await this.client.command(['CREATE', mailbox(path)])
    })
  }

  renameMailbox(path: string, newPath: string): Promise<void> {
    return this.alone(async () => {
      await this.client.command(['RENAME', mailbox(path), mailbox(newPath)])
      if (this.client.selected?.path === path) this.client.selected = null
    })
  }

  deleteMailbox(path: string): Promise<void> {
    return this.alone(async () => {
      await this.client.command(['DELETE', mailbox(path)])
      if (this.client.selected?.path === path) this.client.selected = null
    })
  }

  async pathDelimiter(): Promise<string> {
    return this.alone(async () => {
      const result = await this.client.command(['LIST', '""', '""'])
      const first = dataOf(result, 'LIST')[0]
      const delimiter = first?.kind === 'data' ? first.tokens[1] : undefined
      return delimiter?.type === 'string' && delimiter.bytes.length > 0 ? tokenText(delimiter) : '/'
    })
  }

  async purgeMailbox(imapPath: string): Promise<number> {
    return this.withMailbox(imapPath, async (selected, justSelected) => {
      if (!justSelected) await this.refresh()
      const total = selected.exists
      if (total === 0) return 0
      await this.client.command(['STORE', '1:*', '+FLAGS.SILENT', flagList(['\\Deleted'])])
      await this.client.command(['EXPUNGE'])
      return total
    })
  }
}

/** A UID range as the caller wrote it, checked, because it goes into a command as it is. */
function rangeOf(range: string): string {
  if (!/^\d+(:(\d+|\*))?(,\d+(:(\d+|\*))?)*$/.test(range)) {
    throw new Error(`Not a UID range: ${JSON.stringify(range)}`)
  }
  return range
}
