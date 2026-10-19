import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/**
 * Turning a password into a database key.
 *
 * Kept apart from the profile store so it carries no Electron dependency and can be tested
 * directly. This is the part where a mistake is not a bug but a hole.
 */

/**
 * scrypt parameters. N=2^15 costs on the order of 100 ms, which is slow enough to make
 * guessing expensive and fast enough that unlocking does not feel broken. Raising N later
 * would invalidate existing profiles, so it is fixed rather than tuned per machine.
 */
const SCRYPT_N = 32768
const SCRYPT_r = 8
const SCRYPT_p = 1
const KEY_BYTES = 32

function scrypt(password: string, salt: Buffer, length: number): Buffer {
  return scryptSync(password, salt, length, {
    N: SCRYPT_N,
    r: SCRYPT_r,
    p: SCRYPT_p,
    // The default cap is below what these parameters need.
    maxmem: 128 * SCRYPT_N * SCRYPT_r * 2
  })
}

export function newSalt(): string {
  return randomBytes(16).toString('hex')
}

/** The SQLCipher key, as hex. `PRAGMA key = "x'...'"` expects the raw key, not a passphrase. */
export function deriveKey(password: string, saltHex: string): string {
  return scrypt(password, Buffer.from(saltHex, 'hex'), KEY_BYTES).toString('hex')
}

/**
 * A second, independent derivation from the same password.
 *
 * Deliberately not the database key: this value sits in a readable file, and storing the key
 * there would hand over exactly what the encryption protects. Its only job is to tell a typo
 * apart from a damaged file, so the user gets "wrong password" instead of "not a database".
 */
export function deriveVerifier(password: string, saltHex: string): string {
  const salt = Buffer.concat([Buffer.from(saltHex, 'hex'), Buffer.from('verifier')])
  return scrypt(password, salt, 32).toString('hex')
}

/** Constant-time comparison: a length or early-byte mismatch must not be measurable. */
export function verifierMatches(expectedHex: string, password: string, saltHex: string): boolean {
  const expected = Buffer.from(expectedHex, 'hex')
  const actual = Buffer.from(deriveVerifier(password, saltHex), 'hex')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
