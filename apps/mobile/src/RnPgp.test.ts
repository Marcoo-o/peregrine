import { describe, expect, it } from 'vitest'
import { RnPgp, type PgpModule } from './RnPgp'

describe('the hashing of a sealed key by the platform', () => {
  it('gives the salt and the passphrase as base64 and takes the hash back as bytes', async () => {
    const asked: unknown[][] = []
    const module: PgpModule = {
      iteratedS2k: async (...args) => {
        asked.push(args)
        return 'AQID' // 1, 2, 3
      }
    }
    const hash = await new RnPgp(module).iteratedS2k('sha256', new Uint8Array([104, 105]), new Uint8Array([111, 107]), 65_011_712)
    expect(asked).toEqual([['sha256', 'aGk=', 'b2s=', 65_011_712]])
    expect(Array.from(hash)).toEqual([1, 2, 3])
  })

  it('raises what the platform raises', async () => {
    const module: PgpModule = { iteratedS2k: async () => Promise.reject(new Error('Not a hash for a string-to-key: md5')) }
    await expect(new RnPgp(module).iteratedS2k('md5', new Uint8Array([1]), new Uint8Array([1]), 10)).rejects.toThrow('md5')
  })
})
