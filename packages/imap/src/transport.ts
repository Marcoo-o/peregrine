/**
 * Everything the client needs from the network, and nothing it does not.
 *
 * The client is written against this and knows no socket. On the desktop an implementation wraps
 * Node's `net` and `tls`. On a phone it wraps whatever the platform has. That is the whole reason
 * the protocol is implemented here and not borrowed from a library: the library wants Node.
 *
 * Certificate checking belongs to the implementation, and it must be on. The client asks for TLS
 * and trusts the answer, so a transport that skips verification turns every connection into one
 * anybody on the path can read.
 */

export interface TransportConnectOptions {
  host: string
  port: number
  /** Start with TLS (port 993 style). Otherwise the connection begins in the clear. */
  tls: boolean
}

export interface Transport {
  /** Opens the connection, and with `tls` completes the handshake before returning. */
  connect(options: TransportConnectOptions): Promise<void>

  /**
   * Upgrades the open connection to TLS, for STARTTLS. The server name to check the certificate
   * against is the one given, which is the host that was connected to and not what the server
   * says about itself. Anything received from the clear connection and not yet delivered has to be
   * thrown away: it was sent before encryption and cannot be trusted.
   */
  startTls(host: string): Promise<void>

  write(bytes: Uint8Array): Promise<void>

  /** Closes at once, without waiting for anything still to be sent. */
  close(): void

  /** Called with whatever arrives, in order, in chunks of any size. Set once. */
  onData(listener: (bytes: Uint8Array) => void): void

  /** Called once when the connection ends, with the reason if it ended badly. Set once. */
  onClose(listener: (error?: Error) => void): void
}
