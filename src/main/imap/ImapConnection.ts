import { appError } from '@peregrine/core/errorText'
import type {
  FullMessage,
  ImapSession,
  ImapSessionOptions,
  FetchedMessage,
  MailboxEntry,
  MailboxStatus,
  SyncFetchResult
} from '@peregrine/core/imapSession'
import { ImapFlow, type FetchMessageObject, type ListResponse } from 'imapflow'
import type { SecureMode } from '@peregrine/core/types'
import { createImapLogger } from '../diagnostics/protocolLog'

export type ImapConnectionOptions = ImapSessionOptions

/** imapflow's folder entry, as ours. */
export function toMailboxEntry(box: ListResponse): MailboxEntry {
  return {
    path: box.path,
    name: box.name,
    parentPath: box.parentPath || null,
    flags: Array.from(box.flags ?? []),
    specialUse: box.specialUse ?? null
  }
}

/**
 * A date the sync engine can turn into a timestamp, or nothing.
 *
 * imapflow hands over the header's raw text when JavaScript cannot read it, though its own types
 * say Date. The sync engine then calls `toISOString` on it, which throws, and the whole folder
 * fails to sync because of one message with a broken Date header.
 */
function validDate(value: unknown): Date | undefined {
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : undefined
  return date && !Number.isNaN(date.getTime()) ? date : undefined
}

/**
 * imapflow's fetch result, as ours. Null for a message the server sent without a UID, which
 * nothing could refer to afterwards.
 */
export function toFetchedMessage(msg: FetchMessageObject): FetchedMessage | null {
  if (msg.uid == null) return null
  const envelope = msg.envelope
  const addresses = (list: { name?: string; address?: string }[] | undefined) =>
    list?.map((a) => ({ name: a.name, address: a.address }))
  return {
    uid: msg.uid,
    flags: Array.from(msg.flags ?? []),
    size: msg.size ?? 0,
    envelope: {
      subject: envelope?.subject,
      messageId: envelope?.messageId,
      inReplyTo: envelope?.inReplyTo,
      date: validDate(envelope?.date),
      from: addresses(envelope?.from),
      to: addresses(envelope?.to),
      cc: addresses(envelope?.cc),
      bcc: addresses(envelope?.bcc)
    },
    hasAttachment: Boolean(
      msg.bodyStructure?.childNodes?.some((node) => node.disposition === 'attachment')
    )
  }
}

// imapflow's `secure` flag says implicit TLS (true) or a plain connection (false).
export function toSecureFlag(secure: SecureMode): boolean {
  return secure === 'tls'
}

/**
 * Whether the STARTTLS upgrade has to succeed.
 *
 * Left to imapflow's default, an upgrade is attempted and the connection carries on in the
 * clear when the server does not advertise support. Which server does is decided by a
 * capability list read before any encryption exists, so anything on the path can strike
 * STARTTLS from it and watch the password go by. imapflow names this in its own
 * documentation.
 *
 * So a user who picked STARTTLS gets STARTTLS or nothing, which is what SMTP has always
 * done here through nodemailer's `requireTLS`. Only "no encryption", chosen deliberately,
 * keeps the opportunistic behaviour: an upgrade if one is offered is still better than the
 * plaintext that was asked for.
 */
export function toStartTlsFlag(secure: SecureMode): boolean | undefined {
  // Must stay unset for implicit TLS: imapflow rejects secure together with doSTARTTLS.
  return secure === 'starttls' ? true : undefined
}

/**
 * How long after the last command the connection returns to the mailbox it watches.
 *
 * Shorter than imapflow's fifteen seconds before it starts IDLE by itself: the point of
 * parking is to be back on the inbox *before* that happens, so IDLE never ends up watching
 * whichever folder a background round happened to touch last. During a round each operation
 * pushes the timer back, so parking costs one extra SELECT per quiet period, not per folder.
 */
const PARK_DELAY_MS = 2000

export class ImapConnection implements ImapSession {
  private client: ImapFlow
  private stopped = false
  /** The mailbox this connection returns to when nothing else is going on. */
  private parkPath: string | null = null
  private parkTimer: NodeJS.Timeout | null = null

  constructor(options: ImapConnectionOptions) {
    this.client = new ImapFlow({
      host: options.host,
      port: options.port,
      secure: toSecureFlag(options.secure),
      doSTARTTLS: toStartTlsFlag(options.secure),
      auth: { user: options.username, pass: options.password },
      logger: options.label ? createImapLogger(options.label) : false
    })
  }

  async connect(): Promise<void> {
    await this.client.connect()
  }

  async disconnect(): Promise<void> {
    this.stopped = true
    try {
      await this.client.logout()
    } catch {
      this.client.close()
    }
  }

  onClose(listener: () => void): void {
    this.client.on('close', listener)
  }

  /**
   * Watches a mailbox for arrivals for as long as nothing else is happening.
   *
   * imapflow starts IDLE by itself once a connection has been quiet for fifteen seconds, and
   * any command breaks it and restarts it afterwards. So a second connection just to hold
   * IDLE open buys nothing. What it does need is the right mailbox selected: IDLE reports on
   * whatever is open, and a background round leaves the last folder it touched behind.
   */
  watchMailbox(imapPath: string, onArrival: () => void): void {
    this.parkPath = imapPath
    this.client.on('exists', (event: { path: string; count: number; prevCount: number }) => {
      // Only for the watched mailbox, and only for growth: a fetch of another folder emits
      // this too, and a message being deleted lowers the count.
      if (event.path !== this.parkPath || event.count <= event.prevCount) return
      onArrival()
    })
    void this.park()
  }

  /** Re-selects the watched mailbox once the connection falls quiet. */
  private schedulePark(): void {
    if (!this.parkPath || this.stopped) return
    if (this.parkTimer) clearTimeout(this.parkTimer)
    this.parkTimer = setTimeout(() => void this.park(), PARK_DELAY_MS)
    this.parkTimer.unref?.()
  }

  private async park(): Promise<void> {
    if (this.stopped || !this.parkPath) return
    const open = this.client.mailbox
    if (typeof open === 'object' && open.path === this.parkPath) return
    try {
      // The raw lock, not the wrapper: parking must not schedule another park.
      const lock = await this.client.getMailboxLock(this.parkPath)
      lock.release()
    } catch {
      // Not worth reporting. The next command re-selects anyway, and a connection that
      // cannot select its inbox has larger problems that surface elsewhere.
    }
  }

  /**
   * Takes the mailbox lock and arranges for the connection to return to its watched mailbox
   * afterwards. Every operation goes through here so no caller has to remember.
   */
  private async lockMailbox(imapPath: string): Promise<{ release: () => void }> {
    const lock = await this.client.getMailboxLock(imapPath)
    return {
      release: () => {
        lock.release()
        this.schedulePark()
      }
    }
  }

  onError(listener: (err: Error) => void): void {
    this.client.on('error', listener)
  }

  async listMailboxes(): Promise<MailboxEntry[]> {
    return (await this.client.list()).map(toMailboxEntry)
  }

  /**
   * Asks what state a mailbox is in without selecting it.
   *
   * STATUS is answered from the server's index; SELECT opens the mailbox, which is the
   * expensive part of a refresh. For a folder that has not changed since last time, this one
   * cheap question replaces the whole exchange.
   */
  async mailboxStatus(imapPath: string): Promise<MailboxStatus> {
    // Asking about the mailbox that is already open is asking a question one knows the answer
    // to. The server answers it. Dovecot marks the exchange `[CLIENTBUG]` and does so anyway,
    // but it is a round trip for nothing, and since the connection now parks on the inbox
    // between rounds, that is the folder it would happen to most.
    const open = this.client.mailbox
    if (typeof open === 'object' && open.path === imapPath) {
      return { uidValidity: open.uidValidity, uidNext: open.uidNext, messages: open.exists }
    }

    const status = await this.client.status(imapPath, {
      uidNext: true,
      uidValidity: true,
      messages: true
    })
    return {
      uidValidity: status.uidValidity ?? 0n,
      uidNext: status.uidNext ?? 0,
      messages: status.messages ?? 0
    }
  }

  /**
   * Everything one folder sync needs, in a single mailbox selection.
   *
   * The two fetches are deliberately in the same lock. Opening a mailbox is a full server
   * round trip, and with a dozen folders across several accounts those round trips. Not the
   * amount of data. Are what a refresh actually spends its time on. Splitting this into
   * separate calls tripled the number of selections and made the whole thing slower, even
   * though each individual fetch had become cheaper.
   *
   * `decideRange` runs once the mailbox is open, so the caller can pick the fetch range from
   * the UIDVALIDITY and UIDNEXT it reports without a second selection to ask for them.
   */
  async syncFetch(
    imapPath: string,
    decideRange: (status: { uidValidity: bigint; uidNext: number }) => string | Promise<string>
  ): Promise<SyncFetchResult> {
    const lock = await this.lockMailbox(imapPath)
    try {
      const mailbox = this.client.mailbox
      if (!mailbox || typeof mailbox === 'boolean') {
        throw appError('mailboxOpenFailed', imapPath)
      }
      const status = { uidValidity: mailbox.uidValidity, uidNext: mailbox.uidNext }

      const messages: FetchedMessage[] = []
      for await (const msg of this.client.fetch(
        await decideRange(status),
        { envelope: true, flags: true, uid: true, size: true, bodyStructure: true },
        { uid: true }
      )) {
        const fetched = toFetchedMessage(msg)
        if (fetched) messages.push(fetched)
      }

      // Flags of everything, without envelope or body structure: this is what tells the sync
      // which messages still exist and whether their read state changed elsewhere.
      const flags: { uid: number; flags: string[] }[] = []
      for await (const msg of this.client.fetch('1:*', { flags: true, uid: true }, { uid: true })) {
        if (msg.uid == null) continue
        flags.push({ uid: msg.uid, flags: Array.from(msg.flags ?? []) })
      }

      return { messages, flags, ...status }
    } finally {
      lock.release()
    }
  }

  async fetchFullMessage(imapPath: string, uid: number): Promise<FullMessage | undefined> {
    const lock = await this.lockMailbox(imapPath)
    try {
      const msg = await this.client.fetchOne(String(uid), { source: true, envelope: true }, { uid: true })
      return msg && msg.source ? { source: msg.source } : undefined
    } finally {
      lock.release()
    }
  }

  async setFlags(imapPath: string, uid: number, flags: string[]): Promise<void> {
    const lock = await this.lockMailbox(imapPath)
    try {
      await this.client.messageFlagsSet(String(uid), flags, { uid: true })
    } finally {
      lock.release()
    }
  }

  async addFlags(imapPath: string, uid: number, flags: string[]): Promise<void> {
    const lock = await this.lockMailbox(imapPath)
    try {
      await this.client.messageFlagsAdd(String(uid), flags, { uid: true })
    } finally {
      lock.release()
    }
  }

  async removeFlags(imapPath: string, uid: number, flags: string[]): Promise<void> {
    const lock = await this.lockMailbox(imapPath)
    try {
      await this.client.messageFlagsRemove(String(uid), flags, { uid: true })
    } finally {
      lock.release()
    }
  }

  /**
   * Returns the source-UID → target-UID mapping when the server reports it (UIDPLUS/COPYUID),
   * which is what makes an exact "undo move" possible. Servers without UIDPLUS return null and
   * the caller simply offers no undo rather than guessing at UIDs.
   */
  async moveMessages(
    sourcePath: string,
    targetPath: string,
    uids: number[]
  ): Promise<Map<number, number> | null> {
    const lock = await this.lockMailbox(sourcePath)
    try {
      const result = await this.client.messageMove(uids.join(','), targetPath, { uid: true })
      const uidMap = (result as { uidMap?: Map<number, number> } | undefined)?.uidMap
      return uidMap instanceof Map && uidMap.size > 0 ? uidMap : null
    } finally {
      lock.release()
    }
  }

  async deleteMessages(imapPath: string, uids: number[]): Promise<void> {
    const lock = await this.lockMailbox(imapPath)
    try {
      await this.client.messageFlagsAdd(uids.join(','), ['\\Deleted'], { uid: true })
      await this.client.messageDelete(uids.join(','), { uid: true })
    } finally {
      lock.release()
    }
  }

  /** Returns the new UID when the server reports it (UIDPLUS). Drafts need it to replace
   * their previous revision on the next save. */
  async appendMessage(
    imapPath: string,
    rfc822Source: Uint8Array | string,
    flags: string[] = ['\\Seen']
  ): Promise<number | null> {
    const result = await this.client.append(
      imapPath,
      typeof rfc822Source === 'string' ? rfc822Source : Buffer.from(rfc822Source),
      flags
    )
    const uid = (result as { uid?: number } | undefined)?.uid
    return typeof uid === 'number' ? uid : null
  }

  async createMailbox(path: string): Promise<void> {
    await this.client.mailboxCreate(path)
  }

  async renameMailbox(path: string, newPath: string): Promise<void> {
    await this.client.mailboxRename(path, newPath)
  }

  async deleteMailbox(path: string): Promise<void> {
    await this.client.mailboxDelete(path)
  }

  /** The separator the server uses between path segments ('/' or '.'), needed to build paths. */
  async pathDelimiter(): Promise<string> {
    const boxes = await this.client.list()
    return boxes[0]?.delimiter || '/'
  }

  /** Expunges everything in a mailbox. Used for "empty trash". */
  async purgeMailbox(imapPath: string): Promise<number> {
    const lock = await this.lockMailbox(imapPath)
    try {
      const mailbox = this.client.mailbox
      const total = !mailbox || typeof mailbox === 'boolean' ? 0 : mailbox.exists
      if (total === 0) return 0
      await this.client.messageFlagsAdd('1:*', ['\\Deleted'])
      await this.client.messageDelete('1:*')
      return total
    } finally {
      lock.release()
    }
  }

}
