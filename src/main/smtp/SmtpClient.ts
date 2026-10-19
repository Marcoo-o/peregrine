import { appError } from '@peregrine/core/errorText'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { createTransport, type Transporter } from 'nodemailer'
import type { SecureMode } from '@peregrine/core/types'
import { createSmtpLogger } from '../diagnostics/protocolLog'
import { buildRawMessage, type OutgoingMessage } from './messageBuilder'

export interface SmtpClientOptions {
  host: string
  port: number
  secure: SecureMode
  username: string
  password: string
  /** Name in the diagnostics log; without it this connection is not logged. */
  label?: string
}

export type { OutgoingMessage }

/** Getting a connection and a greeting; a server that needs longer is not reachable. */
const CONNECT_TIMEOUT_MS = 20_000
/** The transfer itself. Long enough for a large attachment on a slow line. */
const SOCKET_TIMEOUT_MS = 120_000
/** Resolving a name; the operating system answers from its cache in milliseconds. */
const DNS_TIMEOUT_MS = 5000

/**
 * Resolves the mail server the way the rest of the system does.
 *
 * nodemailer looks names up with `dns.resolve4`, which queries the configured DNS servers
 * directly. Everything else here, imapflow included, goes through `dns.lookup`, the
 * operating system resolver. Usually both give the same answer, but not behind a VPN: with
 * NordVPN running, direct queries are dropped, and the two disagree in the worst possible
 * way. Measured on this machine while connected: `dns.lookup` 25 ms, `dns.resolve4` a
 * timeout after 28 seconds. And since nodemailer does not fall back after an error, sending
 * failed while the mailbox itself worked perfectly.
 *
 * Passing an IP address makes nodemailer skip its own lookup entirely; `servername` keeps the
 * TLS certificate checked against the real host name rather than against the address.
 */
export async function resolveHost(host: string): Promise<string> {
  if (isIP(host)) return host
  try {
    const timeout = new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error('dns timeout')), DNS_TIMEOUT_MS)
    )
    const { address } = await Promise.race([lookup(host), timeout])
    return address
  } catch {
    // Hand the name to nodemailer unchanged rather than fail here: its own lookup may still
    // succeed, and a name that cannot be resolved at all should fail as a connection error.
    return host
  }
}

export class SmtpClient {
  constructor(private readonly options: SmtpClientOptions) {}

  /**
   * Built per send rather than once.
   *
   * The address is looked up each time, so a server that moved. Or a VPN that came up
   * between two messages. Is noticed. Nothing is pooled here anyway: these transports hold
   * no connection between messages.
   */
  private async transport(): Promise<Transporter> {
    const address = await resolveHost(this.options.host)
    return createTransport({
      host: address,
      // The certificate is still checked against the name, not against the address. Both
      // for SNI and for the identity check, which falls back to `servername` when the host
      // is an IP. Only set when the lookup actually replaced the name.
      tls: address === this.options.host ? undefined : { servername: this.options.host },
      port: this.options.port,
      secure: this.options.secure === 'tls',
      requireTLS: this.options.secure === 'starttls',
      auth: { user: this.options.username, pass: this.options.password },
      // nodemailer waits two minutes to connect and thirty seconds for a greeting by
      // default. The compose window is closed by then, so an unreachable server means two
      // minutes of nothing at all. Not even the notice that the message is waiting.
      connectionTimeout: CONNECT_TIMEOUT_MS,
      greetingTimeout: CONNECT_TIMEOUT_MS,
      // Deliberately not shortened: this one covers the upload, and a large attachment on a
      // slow line legitimately takes a while.
      socketTimeout: SOCKET_TIMEOUT_MS,
      logger: this.options.label ? createSmtpLogger(this.options.label) : false
    })
  }

  async sendMail(message: OutgoingMessage): Promise<{ messageId: string; rawSource: Buffer }> {
    return this.sendRaw(await buildRawMessage(message), message)
  }

  /**
   * Sends a message that was already compiled elsewhere.
   *
   * PGP/MIME messages take this route: their structure has to survive untouched, because
   * rebuilding them would break the signature or the ciphertext boundary.
   */
  async sendRaw(
    rawSource: Buffer,
    envelope: { from: string; to: string[]; cc: string[]; bcc: string[] }
  ): Promise<{ messageId: string; rawSource: Buffer }> {
    const recipients = [...envelope.to, ...envelope.cc, ...envelope.bcc]
    if (recipients.length === 0) {
      throw appError('noRecipients')
    }
    const transporter = await this.transport()
    try {
      // MailComposer strips Bcc from the compiled headers by design, so the SMTP envelope
      // must be passed explicitly here rather than relying on nodemailer to sniff it from `raw`.
      const info = await transporter.sendMail({
        raw: rawSource,
        envelope: { from: envelope.from, to: recipients }
      })
      return { messageId: info.messageId, rawSource }
    } finally {
      transporter.close()
    }
  }
}
