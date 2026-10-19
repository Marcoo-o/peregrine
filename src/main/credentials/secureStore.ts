import { appError } from '@peregrine/core/errorText'
import { safeStorage } from 'electron'

export function encryptSecret(plain: string): Buffer {
  if (!safeStorage.isEncryptionAvailable()) {
    throw appError('osEncryptionUnavailable')
  }
  return safeStorage.encryptString(plain)
}

export function decryptSecret(encrypted: Buffer): string {
  return safeStorage.decryptString(encrypted)
}
