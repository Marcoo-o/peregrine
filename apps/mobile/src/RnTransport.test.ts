import { describe, expect, it } from 'vitest'
import { encodeBase64 } from '@peregrine/imap/mime'
import { RnTransport, type Events, type NativeTransport } from './RnTransport'

type Payload = { id: number; data?: string; error?: string }

/** The device's event emitter and the native module, as far as the transport uses them. */
function device(): { native: FakeNative; events: Events & { emit(event: string, payload: Payload): void } } {
  const listeners = new Map<string, Set<(payload: Payload) => void>>()
  const native = new FakeNative()
  native.events = {
    emit(event, payload) {
      listeners.get(event)?.forEach((listener) => listener(payload))
    },
    count: (event) => listeners.get(event)?.size ?? 0
  }
  return {
    native,
    events: {
      addListener(event, listener) {
        if (!listeners.has(event)) listeners.set(event, new Set())
        listeners.get(event)!.add(listener)
        return { remove: () => listeners.get(event)!.delete(listener) }
      },
      emit: (event, payload) => native.events.emit(event, payload)
    }
  }
}

class FakeNative implements NativeTransport {
  calls: string[] = []
  events!: { emit(event: string, payload: Payload): void; count(event: string): number }
  /** What to send the moment reading starts, like a server greeting does. */
  greeting: string | null = null
  failConnect: Error | null = null
  writes: string[] = []

  async connect(host: string, port: number, tls: boolean): Promise<number> {
    this.calls.push(`connect ${host}:${port} tls=${tls}`)
    if (this.failConnect) throw this.failConnect
    return 7
  }

  start(id: number): void {
    // The listeners have to exist by now, or the greeting would be lost.
    this.calls.push(`start listeners=${this.events.count('PeregrineTransportData')}`)
    if (this.greeting !== null) {
      this.events.emit('PeregrineTransportData', { id, data: encodeBase64(Buffer.from(this.greeting)) })
    }
  }

  async startTls(id: number, host: string): Promise<void> {
    this.calls.push(`startTls ${id} ${host}`)
  }

  async write(id: number, base64: string): Promise<void> {
    this.writes.push(base64)
  }

  close(id: number): void {
    this.calls.push(`close ${id}`)
  }
}

describe('RnTransport', () => {
  it('does not lose the greeting that arrives the moment reading starts', async () => {
    const { native, events } = device()
    native.greeting = '* OK ready\r\n'
    const transport = new RnTransport(native, events)
    const received: string[] = []
    transport.onData((bytes) => received.push(Buffer.from(bytes).toString()))

    await transport.connect({ host: 'mail.example.org', port: 993, tls: true })

    expect(received).toEqual(['* OK ready\r\n'])
    expect(native.calls).toEqual(['connect mail.example.org:993 tls=true', 'start listeners=1'])
  })

  it('passes bytes, binary ones too, across as base64', async () => {
    const { native, events } = device()
    const transport = new RnTransport(native, events)
    await transport.connect({ host: 'h', port: 143, tls: false })
    const bytes = Uint8Array.from([0, 255, 13, 10, 65, 128])

    await transport.write(bytes)

    // read back with a decoder that is not the one under test
    expect([...Buffer.from(native.writes[0], 'base64')]).toEqual([...bytes])
  })

  it('asks for the upgrade with the host that was asked for', async () => {
    const { native, events } = device()
    const transport = new RnTransport(native, events)
    await transport.connect({ host: 'mail.example.org', port: 143, tls: false })

    await transport.startTls('mail.example.org')

    expect(native.calls).toContain('startTls 7 mail.example.org')
  })

  it('ignores what belongs to another connection', async () => {
    const { native, events } = device()
    const transport = new RnTransport(native, events)
    const received: Uint8Array[] = []
    let closed = 0
    transport.onData((bytes) => received.push(bytes))
    transport.onClose(() => closed++)
    await transport.connect({ host: 'h', port: 993, tls: true })

    events.emit('PeregrineTransportData', { id: 8, data: encodeBase64(Uint8Array.from([65])) })
    events.emit('PeregrineTransportClose', { id: 8 })

    expect(received).toEqual([])
    expect(closed).toBe(0)
  })

  it('reports the end once, with the reason, and stops listening', async () => {
    const { native, events } = device()
    const transport = new RnTransport(native, events)
    const ended: (Error | undefined)[] = []
    transport.onClose((error) => ended.push(error))
    await transport.connect({ host: 'h', port: 993, tls: true })

    events.emit('PeregrineTransportClose', { id: 7, error: 'Connection reset' })
    events.emit('PeregrineTransportClose', { id: 7, error: 'again' })

    expect(ended).toHaveLength(1)
    expect(ended[0]?.message).toBe('Connection reset')
    await expect(transport.write(Uint8Array.from([1]))).rejects.toThrow(/closed/)
  })

  it('reports an end without a reason as a clean one', async () => {
    const { native, events } = device()
    const transport = new RnTransport(native, events)
    const ended: (Error | undefined)[] = []
    transport.onClose((error) => ended.push(error))
    await transport.connect({ host: 'h', port: 993, tls: true })

    events.emit('PeregrineTransportClose', { id: 7 })

    expect(ended).toEqual([undefined])
  })

  it('fails to connect with the native error and listens to nothing', async () => {
    const { native, events } = device()
    native.failConnect = new Error('Hostname mismatch')
    const transport = new RnTransport(native, events)

    await expect(transport.connect({ host: 'h', port: 993, tls: true })).rejects.toThrow(
      'Hostname mismatch'
    )

    expect(native.events.count('PeregrineTransportData')).toBe(0)
    expect(native.calls).toEqual(['connect h:993 tls=true'])
  })

  it('refuses to upgrade or write when it is not connected', async () => {
    const { native, events } = device()
    const transport = new RnTransport(native, events)
    await expect(transport.startTls('h')).rejects.toThrow(/Not connected/)
    await expect(transport.write(Uint8Array.from([1]))).rejects.toThrow(/closed/)
  })

  it('closes the native connection when asked', async () => {
    const { native, events } = device()
    const transport = new RnTransport(native, events)
    await transport.connect({ host: 'h', port: 993, tls: true })
    transport.close()
    expect(native.calls).toContain('close 7')
  })
})
