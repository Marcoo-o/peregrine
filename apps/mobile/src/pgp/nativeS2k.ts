import { encodeUtf8 } from '@peregrine/imap/utf8'
import type { PrivateKey } from 'openpgp'
import { openpgp } from './openpgp'

/** What the platform does of the hashing that makes a key of a passphrase: the hash of the iterated and salted string-to-key. */
export interface NativeS2k {
  /** `algorithm` as OpenPGP names it (`sha256`); the hash of the first `count` bytes of the salt and the passphrase repeated. */
  iteratedS2k(algorithm: string, salt: Uint8Array, passphrase: Uint8Array, count: number): Promise<Uint8Array>
}

/** How long the hash of each algorithm is: a key that needs more bytes than one hash has takes several, which stays in JavaScript. */
const DIGEST_BYTES: Record<string, number> = { sha1: 20, sha224: 28, sha256: 32, sha384: 48, sha512: 64 }

interface S2kLike {
  type: string
  algorithm: number
  salt: Uint8Array
  getCount(): number
  produceKey(passphrase: string, numBytes: number, config: unknown): Promise<Uint8Array>
}

const PATCHED = Symbol('peregrine.nativeS2k')

/** The hashing that the replaced method asks: the last that was given, since the class is replaced once and keys are opened for ever. */
let current: NativeS2k | undefined

/**
 * Has the hashing of a sealed key done by the platform, in the key that is about to be opened and in every other that is
 * opened after it. OpenPGP builds the bytes to hash as one array, tens of megabytes of them, and hashes them in JavaScript,
 * which takes the better part of a minute here. The platform hashes the same bytes without ever holding them.
 *
 * Only where the result is the same: the iterated specifier, with a hash that is long enough for the key at one go. What
 * is not that (a key that needs two hashes, the specifiers that do not iterate, Argon2) goes the way it went.
 *
 * It replaces a method of the class of the specifier, which a key that is sealed gives: the class itself is not exported.
 */
export function installNativeS2k(key: PrivateKey, native: NativeS2k): void {
  const packet = (key as unknown as { keyPacket?: { s2k?: S2kLike } }).keyPacket
  if (!packet?.s2k) return
  current = native
  const prototype = Object.getPrototypeOf(packet.s2k) as S2kLike & { [PATCHED]?: boolean }
  if (prototype[PATCHED]) return
  prototype[PATCHED] = true
  const original = prototype.produceKey
  prototype.produceKey = async function (this: S2kLike, passphrase: string, numBytes: number, config: unknown) {
    const algorithm = openpgp.enums.read(openpgp.enums.hash, this.algorithm)
    const length = DIGEST_BYTES[algorithm]
    if (!current || this.type !== 'iterated' || length === undefined || numBytes > length) {
      return original.call(this, passphrase, numBytes, config)
    }
    const digest = await current.iteratedS2k(algorithm, this.salt, encodeUtf8(passphrase), this.getCount())
    return digest.subarray(0, numBytes)
  }
}
