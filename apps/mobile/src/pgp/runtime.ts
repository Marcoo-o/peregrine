import 'react-native-get-random-values'
import { sha1 } from '@noble/hashes/legacy'
import { sha256, sha384, sha512 } from '@noble/hashes/sha2'

/**
 * What OpenPGP needs of the runtime that React Native does not have: the Web Cryptography API. OpenPGP asks for `crypto.subtle`
 * as it is loaded and raises when it is not there. Where it is there it uses it for speed, and where it says that it cannot
 * (a `NotSupportedError`) it falls back to cryptography written in JavaScript. The random numbers come from the platform
 * (`react-native-get-random-values`), which is what must not be written in JavaScript.
 *
 * So `crypto.subtle` is there. It hashes, with the hash functions of `@noble/hashes`, because OpenPGP does not fall back where
 * it hashes; everything else it refuses, in the way OpenPGP reads as "use your own".
 */
function notSupported(): Error {
  return Object.assign(new Error('The Web Cryptography API is not available in this runtime'), { name: 'NotSupportedError' })
}

const refuse = (): Promise<never> => Promise.reject(notSupported())

const HASHES = { 'SHA-1': sha1, 'SHA-256': sha256, 'SHA-384': sha384, 'SHA-512': sha512 } as const

type HashName = keyof typeof HASHES

const isHashName = (name: string): name is HashName => name in HASHES

/** The digest of the bytes, in the shape `crypto.subtle.digest` has: a promise of an ArrayBuffer. */
async function digest(algorithm: string | { name: string }, data: ArrayBuffer | ArrayBufferView): Promise<ArrayBuffer> {
  const name = (typeof algorithm === 'string' ? algorithm : algorithm.name).toUpperCase()
  if (!isHashName(name)) throw notSupported()
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  const hash = HASHES[name](bytes)
  return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength) as ArrayBuffer
}

const subtle = {
  digest,
  importKey: refuse,
  exportKey: refuse,
  generateKey: refuse,
  encrypt: refuse,
  decrypt: refuse,
  sign: refuse,
  verify: refuse,
  deriveBits: refuse,
  deriveKey: refuse,
  wrapKey: refuse,
  unwrapKey: refuse
}

const scope = globalThis as unknown as { crypto?: { subtle?: unknown } }
if (scope.crypto && !scope.crypto.subtle) scope.crypto.subtle = subtle

