import { describe, expect, it } from 'vitest'
import { RnFiles, type NativeFiles } from './RnFiles'

/** A native module that keeps what it is given, and answers as the real one is meant to. */
function fakeNative(over: Partial<NativeFiles> = {}) {
  const calls: string[] = []
  const native: NativeFiles = {
    pick: async () => {
      calls.push('pick')
      return [
        { path: '/store/1/a.pdf', name: 'a.pdf', size: 5, mimeType: 'application/pdf' },
        { path: '/store/2/b', name: 'b', size: 1, mimeType: '' }
      ]
    },
    read: async (path) => {
      calls.push(`read ${path}`)
      return 'aGVsbG8='
    },
    remove: async (paths) => void calls.push(`remove ${paths.join(',')}`),
    save: async (name, type, base64) => {
      calls.push(`save ${name} ${type} ${base64}`)
      return true
    },
    open: async (name, type, base64) => void calls.push(`open ${name} ${type} ${base64}`),
    ...over
  }
  return { files: new RnFiles(native), calls }
}

describe('the files of the device', () => {
  it('lists what was picked, with the type the picker gave or octet-stream for none', async () => {
    const { files } = fakeNative()
    expect(await files.pick()).toEqual([
      { path: '/store/1/a.pdf', name: 'a.pdf', size: 5, contentType: 'application/pdf' },
      { path: '/store/2/b', name: 'b', size: 1, contentType: 'application/octet-stream' }
    ])
  })

  it('has an empty list for no pick', async () => {
    const { files } = fakeNative({ pick: async () => [] })
    expect(await files.pick()).toEqual([])
  })

  it('reads a file as bytes from what crosses the bridge as base64', async () => {
    const { files, calls } = fakeNative()
    expect(new TextDecoder().decode(await files.read('/store/1/a.pdf'))).toBe('hello')
    expect(calls).toEqual(['read /store/1/a.pdf'])
  })

  it('sends bytes across the bridge as base64, to save and to open', async () => {
    const { files, calls } = fakeNative()
    const bytes = Uint8Array.from('hello', (c) => c.charCodeAt(0))
    expect(await files.save('a.txt', 'text/plain', bytes)).toBe(true)
    await files.open('a.txt', 'text/plain', bytes)
    expect(calls).toEqual(['save a.txt text/plain aGVsbG8=', 'open a.txt text/plain aGVsbG8='])
  })

  it('says when nothing was saved', async () => {
    const { files } = fakeNative({ save: async () => false })
    expect(await files.save('a.txt', 'text/plain', new Uint8Array(0))).toBe(false)
  })

  it('does not ask the native side to remove nothing', async () => {
    const { files, calls } = fakeNative()
    await files.remove([])
    await files.remove(['/store/1/a.pdf', '/store/2/b'])
    expect(calls).toEqual(['remove /store/1/a.pdf,/store/2/b'])
  })

  it('passes on the failure of the native side with its reason', async () => {
    const { files } = fakeNative({
      read: async () => {
        throw new Error('No such file')
      }
    })
    await expect(files.read('/store/gone')).rejects.toThrow('No such file')
  })
})
