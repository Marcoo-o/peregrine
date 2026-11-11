import { encodeBase64 } from '@peregrine/imap/mime'
import type { BackupFolder } from './autoBackup'

/** What the native module `PeregrineBackup` offers for a scheduled backup, as it offers it. */
export interface NativeBackupFolder {
  state(): Promise<{ folder: string | null; hasPassword: boolean }>
  chooseFolder(): Promise<string | null>
  rememberPassword(password: string): Promise<void>
  forgetPassword(): Promise<void>
  sealToFolder(name: string, contentBase64: string, keep: number): Promise<void>
  arm(atMillis: number): Promise<void>
  disarm(): Promise<void>
  runNow(): Promise<void>
}

/** The folder of the scheduled backups, the password that is kept for them and the platform's scheduler, through the native module. */
export class RnBackupFolder implements BackupFolder {
  constructor(private readonly native: NativeBackupFolder) {}

  state() {
    return this.native.state()
  }

  chooseFolder() {
    return this.native.chooseFolder()
  }

  rememberPassword(password: string) {
    return this.native.rememberPassword(password)
  }

  forgetPassword() {
    return this.native.forgetPassword()
  }

  sealToFolder(name: string, content: Uint8Array, keep: number) {
    return this.native.sealToFolder(name, encodeBase64(content), keep)
  }

  arm(atMillis: number) {
    return this.native.arm(atMillis)
  }

  disarm() {
    return this.native.disarm()
  }

  runNow() {
    return this.native.runNow()
  }
}
