/**
 * Bytes from the IMAP session as a Buffer, without copying them.
 *
 * The session hands out plain `Uint8Array`, because the interface has to make sense on a platform
 * that has no Buffer. On the desktop what arrives is a Buffer already, and the parsers want one.
 */
export function asBuffer(bytes: Uint8Array): Buffer {
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}
