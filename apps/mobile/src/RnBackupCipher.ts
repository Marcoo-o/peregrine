import type { BackupCipher } from '@peregrine/core/backupFormat'
import { decodeBase64, encodeBase64 } from '@peregrine/imap/mime'

/** What the native module `PeregrineBackup` offers, as it offers it: files and content as base64. */
export interface NativeBackup {
  seal(contentBase64: string, password: string): Promise<string>
  open(fileBase64: string, password: string): Promise<string | null>
}

/** Sealing and opening a backup with a password, through the native module, which does the 600000 rounds that a script cannot. */
export class RnBackupCipher implements BackupCipher {
  constructor(private readonly native: NativeBackup) {}

  async seal(content: Uint8Array, password: string): Promise<Uint8Array> {
    return decodeBase64(await this.native.seal(encodeBase64(content), password))
  }

  async open(file: Uint8Array, password: string): Promise<Uint8Array | null> {
    const content = await this.native.open(encodeBase64(file), password)
    return content === null ? null : decodeBase64(content)
  }
}
