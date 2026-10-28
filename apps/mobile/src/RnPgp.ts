import { decodeBase64, encodeBase64 } from '@peregrine/imap/mime'
import type { NativeS2k } from './pgp/nativeS2k'

/** What the native module `PeregrinePgp` has, as it has it: bytes as base64 strings. */
export interface PgpModule {
  iteratedS2k(algorithm: string, saltBase64: string, passphraseBase64: string, count: number): Promise<string>
}

/** The hashing of a sealed key, done by the platform. The bytes become base64 on the way over and back. */
export class RnPgp implements NativeS2k {
  constructor(private readonly module: PgpModule) {}

  async iteratedS2k(algorithm: string, salt: Uint8Array, passphrase: Uint8Array, count: number): Promise<Uint8Array> {
    return decodeBase64(await this.module.iteratedS2k(algorithm, encodeBase64(salt), encodeBase64(passphrase), count))
  }
}
