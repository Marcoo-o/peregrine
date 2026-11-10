/**
 * The file a backup is written to: the content (see `backupBundle.ts`) sealed with a key made from a password the user knows, so that the file survives what a key held
 * by a device does not: a lost phone, a new one, a reset. It is the format the suite's backups have, with another name: a magic, the number of rounds of the key
 * derivation, the salt, the IV, and then AES-256-GCM. The first three are the authenticated data of the encryption, so a file whose number of rounds was lowered does
 * not open, and a file that asks for more rounds than `MAX_ROUNDS` is not tried, so that a file cannot make the opening spin for minutes.
 *
 * What does the sealing is the platform's: the phone's native side, the desktop's Node. This file is only what is written, so that both write and read the same.
 */

/** What a file begins with: Peregrine Backup, version 1 of the container. */
export const BACKUP_MAGIC = 'PGBK1'

/** What is currently recommended for PBKDF2 with HMAC-SHA-256. */
export const BACKUP_ROUNDS = 600_000

/** The most rounds a file may ask for. */
export const MAX_ROUNDS = 5_000_000

export const SALT_BYTES = 16
export const IV_BYTES = 12
export const TAG_BYTES = 16
export const KEY_BITS = 256

/** The bytes in front of the IV: the magic, the rounds, the salt. They are the authenticated data. */
export const HEADER_BYTES = BACKUP_MAGIC.length + 4 + SALT_BYTES

export interface BackupHeader {
  rounds: number
  salt: Uint8Array
  iv: Uint8Array
  /** Where the sealed content begins. */
  bodyAt: number
}

/** The header of a new file. */
export function buildHeader(rounds: number, salt: Uint8Array): Uint8Array {
  const header = new Uint8Array(HEADER_BYTES)
  for (let i = 0; i < BACKUP_MAGIC.length; i++) header[i] = BACKUP_MAGIC.charCodeAt(i)
  new DataView(header.buffer).setUint32(BACKUP_MAGIC.length, rounds, false)
  header.set(salt, BACKUP_MAGIC.length + 4)
  return header
}

/** What a file says of itself, or null when it is not one of ours, is cut off, or asks for a number of rounds that is not reasonable. */
export function parseHeader(file: Uint8Array): BackupHeader | null {
  if (file.length < HEADER_BYTES + IV_BYTES + TAG_BYTES) return null
  for (let i = 0; i < BACKUP_MAGIC.length; i++) if (file[i] !== BACKUP_MAGIC.charCodeAt(i)) return null
  const rounds = new DataView(file.buffer, file.byteOffset, file.byteLength).getUint32(BACKUP_MAGIC.length, false)
  if (rounds < 1 || rounds > MAX_ROUNDS) return null
  return {
    rounds,
    salt: file.slice(BACKUP_MAGIC.length + 4, HEADER_BYTES),
    iv: file.slice(HEADER_BYTES, HEADER_BYTES + IV_BYTES),
    bodyAt: HEADER_BYTES + IV_BYTES
  }
}

/** Seals and opens a backup. The phone's is native, since a script derives 600000 rounds in minutes; the desktop's and the tests' are Node's. */
export interface BackupCipher {
  /** The file for the content, sealed with the password. */
  seal(content: Uint8Array, password: string): Promise<Uint8Array>
  /** The content of a file, or null when the password is wrong, the file was changed, or it is not a backup. */
  open(file: Uint8Array, password: string): Promise<Uint8Array | null>
}
