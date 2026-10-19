import net from 'node:net'
import tls from 'node:tls'
import type { Transport, TransportConnectOptions } from '@peregrine/imap/transport'

/** How long a connection may take to be established, handshake included. */
const CONNECT_TIMEOUT_MS = 30_000

/**
 * The desktop's transport: Node's own sockets under the client from @peregrine/imap.
 *
 * Certificates are checked, against the host that was asked for, and there is no switch to turn
 * that off here. A test that has to talk to a server with a certificate of its own makes the whole
 * process accept it through the environment, where it cannot be mistaken for a setting of the
 * application.
 */
export class NodeTransport implements Transport {
  private socket: net.Socket | tls.TLSSocket | null = null
  private dataListener: (bytes: Uint8Array) => void = () => undefined
  private closeListener: (error?: Error) => void = () => undefined
  private closed = false

  onData(listener: (bytes: Uint8Array) => void): void {
    this.dataListener = listener
  }

  onClose(listener: (error?: Error) => void): void {
    this.closeListener = listener
  }

  async connect(options: TransportConnectOptions): Promise<void> {
    const socket = options.tls
      ? tls.connect({ host: options.host, port: options.port, ...serverName(options.host) })
      : net.connect({ host: options.host, port: options.port })
    await this.establish(socket, options.tls ? 'secureConnect' : 'connect')
    this.attach(socket)
  }

  async startTls(host: string): Promise<void> {
    const plain = this.socket
    if (!plain) throw new Error('Not connected')
    // The clear connection stops being listened to before the handshake starts. Whatever it has
    // buffered but not delivered was sent before encryption and is not to be believed.
    plain.removeAllListeners('data')
    plain.removeAllListeners('close')
    plain.removeAllListeners('error')
    plain.pause()
    const secure = tls.connect({ socket: plain, ...serverName(host) })
    await this.establish(secure, 'secureConnect')
    this.attach(secure)
  }

  write(bytes: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = this.socket
      if (!socket || socket.destroyed) {
        reject(new Error('The connection is closed'))
        return
      }
      socket.write(bytes, (error) => (error ? reject(error) : resolve()))
    })
  }

  close(): void {
    this.socket?.destroy()
  }

  private establish(socket: net.Socket, event: 'connect' | 'secureConnect'): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.destroy()
        reject(new Error('Connecting timed out'))
      }, CONNECT_TIMEOUT_MS)
      const failed = (error: Error): void => {
        clearTimeout(timer)
        socket.destroy()
        reject(error)
      }
      socket.once('error', failed)
      socket.once(event, () => {
        clearTimeout(timer)
        socket.removeListener('error', failed)
        resolve()
      })
    })
  }

  private attach(socket: net.Socket): void {
    this.socket = socket
    // Small commands should leave at once, not wait to be joined by the next.
    socket.setNoDelay(true)
    socket.on('data', (chunk: Buffer) => this.dataListener(chunk))
    let failure: Error | undefined
    socket.on('error', (error) => {
      failure = error
    })
    socket.on('close', () => {
      if (this.closed) return
      this.closed = true
      this.closeListener(failure)
    })
    socket.resume()
  }
}

/** The name to check the certificate against. Not set for an address, which Node refuses. */
function serverName(host: string): { servername?: string } {
  return net.isIP(host) ? {} : { servername: host }
}
