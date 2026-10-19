import type { Transport, TransportConnectOptions } from '@peregrine/imap/transport'
import { decodeBase64, encodeBase64 } from '@peregrine/imap/mime'

/** What `PeregrineTransportModule.kt` offers. */
export interface NativeTransport {
  connect(host: string, port: number, tls: boolean): Promise<number>
  start(id: number): void
  startTls(id: number, host: string): Promise<void>
  write(id: number, base64: string): Promise<void>
  close(id: number): void
}

/** The part of the event emitter this uses, so a test can stand in for the device's. */
export interface Events {
  addListener(
    event: string,
    listener: (payload: { id: number; data?: string; error?: string }) => void
  ): { remove(): void }
}

const DATA_EVENT = 'PeregrineTransportData'
const CLOSE_EVENT = 'PeregrineTransportClose'

/**
 * The phone's `Transport`: the native module under the client from @peregrine/imap.
 *
 * The certificate is checked against the host that was asked for, in the native module, which has
 * no way to be told not to. Nothing here can weaken that, and nothing here should try.
 */
export class RnTransport implements Transport {
  private id: number | null = null
  private subscriptions: { remove(): void }[] = []
  private dataListener: (bytes: Uint8Array) => void = () => undefined
  private closeListener: (error?: Error) => void = () => undefined

  /** The native module and the device's events are handed in, so a test needs no device. */
  constructor(
    private readonly native: NativeTransport,
    private readonly events: Events
  ) {}

  onData(listener: (bytes: Uint8Array) => void): void {
    this.dataListener = listener
  }

  onClose(listener: (error?: Error) => void): void {
    this.closeListener = listener
  }

  async connect(options: TransportConnectOptions): Promise<void> {
    const id = await this.native.connect(options.host, options.port, options.tls)
    this.id = id
    this.subscriptions = [
      this.events.addListener(DATA_EVENT, (event) => {
        if (event.id === id && event.data !== undefined) this.dataListener(decodeBase64(event.data))
      }),
      this.events.addListener(CLOSE_EVENT, (event) => {
        if (event.id !== id) return
        this.release()
        this.closeListener(event.error ? new Error(event.error) : undefined)
      })
    ]
    // Only now does the native side start reading, so the greeting has somewhere to go.
    this.native.start(id)
  }

  async startTls(host: string): Promise<void> {
    if (this.id === null) throw new Error('Not connected')
    await this.native.startTls(this.id, host)
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (this.id === null) throw new Error('The connection is closed')
    await this.native.write(this.id, encodeBase64(bytes))
  }

  close(): void {
    if (this.id !== null) this.native.close(this.id)
  }

  private release(): void {
    this.subscriptions.forEach((subscription) => subscription.remove())
    this.subscriptions = []
    this.id = null
  }
}
