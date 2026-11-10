import { createCipheriv, createDecipheriv, pbkdf2, randomBytes } from 'node:crypto'
import { BACKUP_ROUNDS, buildHeader, IV_BYTES, KEY_BITS, parseHeader, SALT_BYTES, TAG_BYTES, type BackupCipher } from '../src/backupFormat'

const derive = (password: string, salt: Uint8Array, rounds: number): Promise<Buffer> =>
  new Promise((resolve, reject) => pbkdf2(password, salt, rounds, KEY_BITS / 8, 'sha256', (error, key) => (error ? reject(error) : resolve(key))))

/**
 * The cipher on Node: for the desktop, and for the tests that check what the phone's native side writes against it. `rounds`, `salt` and `iv` can be given to make a file
 * that is the same every time, which is how a test vector is made; a real file has none of them given.
 */
export function nodeBackupCipher(options: { rounds?: number; salt?: Uint8Array; iv?: Uint8Array } = {}): BackupCipher {
  return {
    async seal(content, password) {
      const rounds = options.rounds ?? BACKUP_ROUNDS
      const salt = options.salt ?? randomBytes(SALT_BYTES)
      const iv = options.iv ?? randomBytes(IV_BYTES)
      const header = buildHeader(rounds, salt)
      const cipher = createCipheriv('aes-256-gcm', await derive(password, salt, rounds), iv)
      cipher.setAAD(header)
      const sealed = Buffer.concat([cipher.update(content), cipher.final(), cipher.getAuthTag()])
      return Uint8Array.from(Buffer.concat([header, iv, sealed]))
    },
    async open(file, password) {
      const header = parseHeader(file)
      if (!header) return null
      try {
        const body = file.slice(header.bodyAt)
        const decipher = createDecipheriv('aes-256-gcm', await derive(password, header.salt, header.rounds), header.iv)
        decipher.setAAD(file.slice(0, header.bodyAt - IV_BYTES))
        decipher.setAuthTag(body.slice(body.length - TAG_BYTES))
        return Uint8Array.from(Buffer.concat([decipher.update(body.slice(0, body.length - TAG_BYTES)), decipher.final()]))
      } catch {
        return null
      }
    }
  }
}
