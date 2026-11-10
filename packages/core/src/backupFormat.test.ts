import { describe, expect, it } from 'vitest'
import { nodeBackupCipher } from '../test-support/backupCipherNode'
import { BACKUP_MAGIC, buildHeader, HEADER_BYTES, IV_BYTES, MAX_ROUNDS, parseHeader } from './backupFormat'

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)
const text = (data: Uint8Array | null): string | null => (data === null ? null : new TextDecoder().decode(data))
const fast = { rounds: 1000 }

describe('the file of a backup', () => {
  it('opens with the password it was sealed with, and with no other', async () => {
    const cipher = nodeBackupCipher(fast)
    const file = await cipher.seal(bytes('the accounts, café, naïve'), 'correct horse')
    expect(text(await cipher.open(file, 'correct horse'))).toBe('the accounts, café, naïve')
    expect(await cipher.open(file, 'wrong horse')).toBeNull()
  })

  it('begins with its magic, the rounds and the salt, which are read back', async () => {
    const file = await nodeBackupCipher({ rounds: 1234 }).seal(bytes('x'), 'pw')
    expect(new TextDecoder().decode(file.slice(0, BACKUP_MAGIC.length))).toBe('PGBK1')
    const header = parseHeader(file)
    expect(header).toMatchObject({ rounds: 1234, bodyAt: HEADER_BYTES + IV_BYTES })
    expect(header?.salt).toHaveLength(16)
  })

  it('is not the same twice, for the same content and password', async () => {
    const cipher = nodeBackupCipher(fast)
    expect(await cipher.seal(bytes('same'), 'pw')).not.toEqual(await cipher.seal(bytes('same'), 'pw'))
  })

  it('does not open when one byte of it was changed, in the body or in the header', async () => {
    const cipher = nodeBackupCipher(fast)
    const file = await cipher.seal(bytes('content'), 'pw')
    for (const at of [file.length - 1, HEADER_BYTES + IV_BYTES + 1, 7, 12]) {
      const changed = Uint8Array.from(file)
      changed[at] ^= 1
      expect(await cipher.open(changed, 'pw')).toBeNull()
    }
  })

  it('does not open when the number of rounds was lowered, since the header is authenticated', async () => {
    const file = await nodeBackupCipher({ rounds: 2000 }).seal(bytes('content'), 'pw')
    const lowered = Uint8Array.from(file)
    new DataView(lowered.buffer).setUint32(BACKUP_MAGIC.length, 1000, false)
    expect(await nodeBackupCipher().open(lowered, 'pw')).toBeNull()
  })

  it('is refused, without trying, when it is not a backup, is cut off, or asks for too many rounds', async () => {
    const cipher = nodeBackupCipher(fast)
    expect(await cipher.open(bytes('not a backup at all, but long enough to be read as one of them'), 'pw')).toBeNull()
    expect(await cipher.open(new Uint8Array(10), 'pw')).toBeNull()
    const file = await cipher.seal(bytes('content'), 'pw')
    expect(await cipher.open(file.slice(0, HEADER_BYTES + 5), 'pw')).toBeNull()
    const greedy = Uint8Array.from(file)
    new DataView(greedy.buffer).setUint32(BACKUP_MAGIC.length, MAX_ROUNDS + 1, false)
    expect(parseHeader(greedy)).toBeNull()
    new DataView(greedy.buffer).setUint32(BACKUP_MAGIC.length, 0, false)
    expect(parseHeader(greedy)).toBeNull()
  })

  it('has a header that is what a reader expects', () => {
    const header = buildHeader(600000, new Uint8Array(16).fill(7))
    expect(header).toHaveLength(HEADER_BYTES)
    expect(Array.from(header.slice(5, 9))).toEqual([0, 9, 39, 192])
  })

  it('is a fixed file for a fixed salt and IV, which is the vector the native side is checked against', async () => {
    const salt = Uint8Array.from({ length: 16 }, (_, i) => i)
    const iv = Uint8Array.from({ length: 12 }, (_, i) => 100 + i)
    const file = await nodeBackupCipher({ rounds: 1000, salt, iv }).seal(bytes('peregrine'), 'secret')
    // Written into BackupCipherTest.kt: both sides have to make and read exactly this.
    expect(Buffer.from(file).toString('hex')).toBe(VECTOR)
  })
})

const VECTOR = '5047424b31000003e8000102030405060708090a0b0c0d0e0f6465666768696a6b6c6d6e6fa8e216204591b0d5549d5608575045b02f2730b405afbd574a'
