import net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { NodeTransport } from './NodeTransport'

const servers: net.Server[] = []
const sockets: net.Socket[] = []

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy()
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))
  )
})

/** A server on a free port that hands each connection to `onConnection`. */
async function listen(onConnection: (socket: net.Socket) => void): Promise<number> {
  const server = net.createServer((socket) => {
    sockets.push(socket)
    onConnection(socket)
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return (server.address() as net.AddressInfo).port
}

const text = (bytes: Uint8Array): string => Buffer.from(bytes).toString('latin1')

function transport(): { transport: NodeTransport; received: string[]; closes: (Error | undefined)[] } {
  const t = new NodeTransport()
  const received: string[] = []
  const closes: (Error | undefined)[] = []
  t.onData((bytes) => received.push(text(bytes)))
  t.onClose((error) => closes.push(error))
  return { transport: t, received, closes }
}

const until = async (condition: () => boolean): Promise<void> => {
  for (let i = 0; i < 100 && !condition(); i++) await new Promise((r) => setTimeout(r, 10))
}

describe('NodeTransport', () => {
  it('delivers what arrives and sends what is written', async () => {
    const port = await listen((socket) => {
      socket.write('* OK hello\r\n')
      socket.on('data', (chunk) => socket.write(`echo:${chunk.toString('latin1')}`))
    })
    const { transport: t, received } = transport()

    await t.connect({ host: '127.0.0.1', port, tls: false })
    await t.write(Uint8Array.from(Buffer.from('A1 NOOP\r\n')))
    await until(() => received.join('').includes('echo:'))

    expect(received.join('')).toBe('* OK hello\r\necho:A1 NOOP\r\n')
    t.close()
  })

  it('reports a connection that is refused', async () => {
    const port = await listen(() => undefined)
    await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))))
    await expect(new NodeTransport().connect({ host: '127.0.0.1', port, tls: false })).rejects.toThrow()
  })

  it('tells the listener once when the server hangs up', async () => {
    const port = await listen((socket) => socket.end())
    const { transport: t, closes } = transport()
    await t.connect({ host: '127.0.0.1', port, tls: false })
    await until(() => closes.length > 0)
    await new Promise((r) => setTimeout(r, 30))
    expect(closes).toHaveLength(1)
  })

  it('tells the listener when it closes the connection itself', async () => {
    const port = await listen(() => undefined)
    const { transport: t, closes } = transport()
    await t.connect({ host: '127.0.0.1', port, tls: false })
    t.close()
    await until(() => closes.length > 0)
    expect(closes).toHaveLength(1)
  })

  it('refuses to write to a connection that is gone', async () => {
    const port = await listen((socket) => socket.end())
    const { transport: t, closes } = transport()
    await t.connect({ host: '127.0.0.1', port, tls: false })
    await until(() => closes.length > 0)
    await expect(t.write(Uint8Array.from([65]))).rejects.toThrow(/closed/)
  })

  // The case STARTTLS exists to be safe against: the server, or something between, answers the
  // upgrade with plain text. The handshake has to fail and say so, never carry on in the clear.
  it('fails the upgrade when the other end does not speak TLS', async () => {
    const port = await listen((socket) => {
      socket.on('data', () => socket.write('* OK this is not a handshake\r\n'))
    })
    const { transport: t } = transport()
    await t.connect({ host: '127.0.0.1', port, tls: false })

    await expect(t.startTls('localhost')).rejects.toThrow()
    t.close()
  })

  it('fails a TLS connection to a server that does not speak TLS', async () => {
    const port = await listen((socket) => socket.write('* OK plain\r\n'))
    await expect(new NodeTransport().connect({ host: '127.0.0.1', port, tls: true })).rejects.toThrow()
  })

  it('cannot upgrade a connection that was never opened', async () => {
    await expect(new NodeTransport().startTls('localhost')).rejects.toThrow(/Not connected/)
  })
})
