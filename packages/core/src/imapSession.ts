import type { SecureMode } from './types'

/**
 * What the rest of the application asks of an IMAP connection, and nothing else.
 *
 * Everything above the connection speaks to this and to the types below, and knows no library.
 * That is the point of it: the application can run on whatever answers to these twenty methods,
 * and a phone needs its own answer, because the library the desktop uses is built on Node.
 *
 * The types are ours on purpose. They used to be the library's, which meant the sync engine read
 * fields straight off an object another project defines, and a second implementation would have
 * had to build that project's objects to be understood.
 */

export interface ImapSessionOptions {
  host: string
  port: number
  secure: SecureMode
  username: string
  password: string
  /**
   * How this connection is named in the diagnostics log. Without it the connection is not
   * logged at all. A one-off test connection has nothing to explain.
   */
  label?: string
}

/** One folder as the server lists it. */
export interface MailboxEntry {
  /** Full path, in the server's own spelling and with its own delimiter. */
  path: string
  /** The last segment of the path. */
  name: string
  /** The path of the folder this one sits in, or null at the top. */
  parentPath: string | null
  /** Attributes such as `\HasChildren`, as the server sent them. */
  flags: string[]
  /** The RFC 6154 role (`\Sent`, `\Trash` and so on) when the server names one. */
  specialUse: string | null
}

export interface EnvelopeAddress {
  name?: string
  address?: string
}

export interface FetchedEnvelope {
  subject?: string
  messageId?: string
  inReplyTo?: string
  date?: Date
  from?: EnvelopeAddress[]
  to?: EnvelopeAddress[]
  cc?: EnvelopeAddress[]
  bcc?: EnvelopeAddress[]
}

/** What a folder sync learns about one message without fetching its body. */
export interface FetchedMessage {
  uid: number
  flags: string[]
  size: number
  envelope: FetchedEnvelope
  /**
   * Whether a direct part of the message is marked as an attachment. Only the first level is
   * looked at, as it always was: a part inside a nested multipart is not counted.
   */
  hasAttachment: boolean
}

export interface MailboxStatus {
  uidValidity: bigint
  uidNext: number
  messages: number
}

export interface SyncFetchResult {
  /** The messages in the range that was decided on. */
  messages: FetchedMessage[]
  /** Flags of every message in the folder. Cheap, and the basis for detecting removals. */
  flags: { uid: number; flags: string[] }[]
  uidValidity: bigint
  uidNext: number
}

/** A message in full, as the server holds it. */
export interface FullMessage {
  source: Uint8Array
}

export interface ImapSession {
  connect(): Promise<void>
  disconnect(): Promise<void>
  onClose(listener: () => void): void
  onError(listener: (err: Error) => void): void

  /**
   * Watches a mailbox for arrivals for as long as nothing else is happening, and calls back
   * when the number of messages in it grows.
   */
  watchMailbox(imapPath: string, onArrival: () => void): void

  listMailboxes(): Promise<MailboxEntry[]>

  /**
   * Asks what state a mailbox is in, preferably without selecting it. For a folder that has not
   * changed since last time, this one cheap question replaces the whole exchange.
   */
  mailboxStatus(imapPath: string): Promise<MailboxStatus>

  /**
   * Everything one folder sync needs, in a single mailbox selection.
   *
   * `decideRange` runs once the mailbox is open, so the caller can pick the fetch range from the
   * UIDVALIDITY and UIDNEXT it reports without a second selection to ask for them.
   */
  syncFetch(
    imapPath: string,
    decideRange: (status: { uidValidity: bigint; uidNext: number }) => string | Promise<string>
  ): Promise<SyncFetchResult>

  /**
   * The headers of the messages with these UIDs, in a folder: what a sync fetches for a range, for UIDs that are not a range. A
   * UID the server does not have is left out. This is how older messages are loaded a page at a time: the UIDs come from the
   * list of every message of the folder that a sync gives, so that a folder numbered with gaps still gives full pages.
   */
  fetchMessages(imapPath: string, uids: number[]): Promise<FetchedMessage[]>

  fetchFullMessage(imapPath: string, uid: number): Promise<FullMessage | undefined>

  setFlags(imapPath: string, uid: number, flags: string[]): Promise<void>
  addFlags(imapPath: string, uid: number, flags: string[]): Promise<void>
  removeFlags(imapPath: string, uid: number, flags: string[]): Promise<void>

  /**
   * Returns the source UID to target UID mapping when the server reports it (UIDPLUS), which is
   * what makes an exact "undo move" possible. Servers without UIDPLUS return null and the caller
   * offers no undo rather than guessing at UIDs.
   */
  moveMessages(
    sourcePath: string,
    targetPath: string,
    uids: number[]
  ): Promise<Map<number, number> | null>

  deleteMessages(imapPath: string, uids: number[]): Promise<void>

  /**
   * Returns the new UID when the server reports it (UIDPLUS). Drafts need it to replace their
   * previous revision on the next save.
   */
  appendMessage(
    imapPath: string,
    rfc822Source: Uint8Array | string,
    flags?: string[]
  ): Promise<number | null>

  createMailbox(path: string): Promise<void>
  renameMailbox(path: string, newPath: string): Promise<void>
  deleteMailbox(path: string): Promise<void>

  /** The separator the server uses between path segments ('/' or '.'), needed to build paths. */
  pathDelimiter(): Promise<string>

  /** Expunges everything in a mailbox. Used for "empty trash". Returns how many were removed. */
  purgeMailbox(imapPath: string): Promise<number>
}
