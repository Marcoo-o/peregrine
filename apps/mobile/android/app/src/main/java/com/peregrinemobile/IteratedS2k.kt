package com.peregrinemobile

import java.security.MessageDigest

/**
 * The iterated and salted string-to-key of OpenPGP (RFC 4880, 3.7.1.3), which is how a private key that is sealed with a
 * passphrase gets the key that seals it: the salt and the passphrase, written one after the other again and again until
 * a number of bytes is reached, are hashed. That number is tens of millions for a key from a mail program, which the
 * platform hashes in a fraction of a second and a script in the better part of a minute, and so it is done here.
 *
 * Nothing near that many bytes is ever held: the hash is fed from a block of some 64 KiB that is the repeated data, so that
 * the memory is the block and the time is the hashing.
 */
object IteratedS2k {
  /** How big the block is that the hash is fed from, at least. */
  private const val BLOCK_BYTES = 64 * 1024

  /** The names OpenPGP gives the hashes, and the platform's for them. */
  private val ALGORITHMS = mapOf(
    "sha1" to "SHA-1",
    "sha224" to "SHA-224",
    "sha256" to "SHA-256",
    "sha384" to "SHA-384",
    "sha512" to "SHA-512"
  )

  /**
   * The hash of the first `count` bytes of the salt and the passphrase repeated, or of one whole of them when `count` is less,
   * which is what OpenPGP does: the specifier never hashes less than it was given.
   */
  fun digest(algorithm: String, salt: ByteArray, passphrase: ByteArray, count: Long): ByteArray {
    val name = ALGORITHMS[algorithm] ?: throw IllegalArgumentException("Not a hash for a string-to-key: $algorithm")
    val data = salt + passphrase
    require(data.isNotEmpty()) { "There is nothing to hash" }
    val digest = MessageDigest.getInstance(name)

    val repeats = (BLOCK_BYTES + data.size - 1) / data.size
    val block = ByteArray(repeats * data.size) { data[it % data.size] }
    var remaining = maxOf(count, data.size.toLong())
    while (remaining >= block.size) {
      digest.update(block)
      remaining -= block.size
    }
    // What is left is less than the block, and the block is the data repeated, so the start of it is the start of the rest.
    if (remaining > 0) digest.update(block, 0, remaining.toInt())
    return digest.digest()
  }
}
