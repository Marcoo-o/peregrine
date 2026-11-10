package com.peregrinemobile

import java.nio.ByteBuffer
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * The sealing of a backup with a password: PBKDF2 with HMAC-SHA-256 and AES-256-GCM, in the file that `packages/core/src/backupFormat.ts` describes and that the
 * desktop writes and reads with Node. A script does 600000 rounds in minutes and the platform in a second, which is why this is native.
 *
 * A file is the magic, the number of rounds (four bytes), the salt, the IV, and the sealed content with its tag. The first three are the authenticated data, so a
 * file with its rounds lowered does not open, and a file that asks for more than [MAX_ROUNDS] is not tried.
 */
object BackupCipher {
  const val MAGIC = "PGBK1"
  const val ROUNDS = 600_000
  const val MAX_ROUNDS = 5_000_000
  private const val SALT_BYTES = 16
  private const val IV_BYTES = 12
  private const val TAG_BITS = 128
  private const val KEY_BITS = 256

  private const val HEADER_BYTES = 5 + 4 + SALT_BYTES

  private fun deriveKey(password: CharArray, salt: ByteArray, rounds: Int): SecretKeySpec {
    val spec = PBEKeySpec(password, salt, rounds, KEY_BITS)
    try {
      return SecretKeySpec(SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded, "AES")
    } finally {
      spec.clearPassword()
    }
  }

  /** The file for the content. `salt` and `iv` are given only by a test, to make a file that is the same every time. */
  fun seal(
    content: ByteArray,
    password: CharArray,
    rounds: Int = ROUNDS,
    salt: ByteArray = ByteArray(SALT_BYTES).also { SecureRandom().nextBytes(it) },
    iv: ByteArray = ByteArray(IV_BYTES).also { SecureRandom().nextBytes(it) }
  ): ByteArray {
    val header = MAGIC.toByteArray(Charsets.US_ASCII) + ByteBuffer.allocate(4).putInt(rounds).array() + salt
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, deriveKey(password, salt, rounds), GCMParameterSpec(TAG_BITS, iv))
    cipher.updateAAD(header)
    return header + iv + cipher.doFinal(content)
  }

  /** The content of a file, or null when the password is wrong, the file was changed, or it is not a backup. */
  fun open(file: ByteArray, password: CharArray): ByteArray? {
    if (file.size < HEADER_BYTES + IV_BYTES + TAG_BITS / 8) return null
    if (String(file, 0, MAGIC.length, Charsets.US_ASCII) != MAGIC) return null
    val rounds = ByteBuffer.wrap(file, MAGIC.length, 4).int
    if (rounds < 1 || rounds > MAX_ROUNDS) return null
    val salt = file.copyOfRange(MAGIC.length + 4, HEADER_BYTES)
    val iv = file.copyOfRange(HEADER_BYTES, HEADER_BYTES + IV_BYTES)
    return try {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, deriveKey(password, salt, rounds), GCMParameterSpec(TAG_BITS, iv))
      cipher.updateAAD(file, 0, HEADER_BYTES)
      cipher.doFinal(file, HEADER_BYTES + IV_BYTES, file.size - HEADER_BYTES - IV_BYTES)
    } catch (_: Exception) {
      null
    }
  }
}
