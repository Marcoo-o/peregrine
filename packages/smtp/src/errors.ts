/**
 * What can go wrong when sending, in the few kinds a caller has to tell apart.
 *
 * The kind says where it went wrong and so what to say to the person: a refused login is theirs to
 * fix, a refused recipient is a typo or a bounce, a message the server will not take is the
 * server's say. `temporary` says whether trying again later can help, which is what an offline
 * queue needs to know, and it is the server's own word for it: a reply in the 400s asks for another
 * try, one in the 500s does not.
 */
export type SmtpErrorKind =
  /** No connection, or none that could be used: refused, unreachable, no greeting. */
  | 'connection'
  /** Encryption was asked for and could not be had. Nothing was sent in the clear. */
  | 'tls'
  /** The login was refused, or the server offers no way to log in that this can use. */
  | 'auth'
  /** The server said something that is not SMTP, or too much of it. */
  | 'protocol'
  /** The server refused the sender. */
  | 'sender'
  /** The server refused every recipient. */
  | 'recipient'
  /** The server refused the message itself, or the way it was offered. */
  | 'rejected'
  /** What was asked for cannot be sent, and nothing was sent. An address that is not one. */
  | 'invalid'
  /** The server did not answer in time. */
  | 'timeout'
  /** The connection ended while it was in use. */
  | 'closed'

export class SmtpError extends Error {
  readonly kind: SmtpErrorKind
  /** The status code of the reply that caused it, when there was one. */
  readonly code: number | null
  /** The server's own words, for the diagnostics log and for somebody who has to ask the provider. */
  readonly response: string | null
  /** True when trying again later may work. */
  readonly temporary: boolean

  constructor(
    kind: SmtpErrorKind,
    message: string,
    details: { code?: number | null; response?: string | null } = {}
  ) {
    super(message)
    this.name = 'SmtpError'
    this.kind = kind
    this.code = details.code ?? null
    this.response = details.response ?? null
    // The server's own word decides when it gave one: a 554 at the greeting is a no, and a 421 is a
    // not now. Only where there was no reply, the kind says: a connection that could not be made
    // or ended, or did not answer, may well work later.
    this.temporary =
      this.code !== null
        ? this.code >= 400 && this.code < 500
        : kind === 'timeout' || kind === 'closed' || kind === 'connection'
  }
}
