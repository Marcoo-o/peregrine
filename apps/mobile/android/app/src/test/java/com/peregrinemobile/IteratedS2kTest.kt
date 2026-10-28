package com.peregrinemobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class IteratedS2kTest {
  private val salt = byteArrayOf(1, 2, 3, 4, 5, 6, 7, 8)
  private val passphrase = "correct horse".toByteArray(Charsets.UTF_8)

  private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }

  // The expected values were made with a plain loop in another program, byte by byte, as the specification says it.

  @Test
  fun hashesTheCountOfBytesOfTheRepeatedSaltAndPassphraseThatAKeyFromAMailProgramUses() {
    assertEquals(
      "c04210598309eba4f5f776dc49348592259796de060d182483b747230bc2a2a6",
      hex(IteratedS2k.digest("sha256", salt, passphrase, 65_011_712))
    )
  }

  @Test
  fun hashesWhatIsLeftOfTheLastCopyWhenTheCountIsNotAWholeNumberOfThem() {
    assertEquals(
      "eab375f2e117a62e2a1e978b8a5dc9c4c5730cf47e91ec02c2a2c40925c51b91c2ab05bfd7b0191d877b56c71bb2322e37d892170d50b0831d672abf07694c1c",
      hex(IteratedS2k.digest("sha512", salt, passphrase, 123_457))
    )
    assertEquals(
      "7dc067aa9e57b46bb1fbd9c4ca8207437d08764ab34afe40d84061bf17687e5502be8adeff15479d19a4ac97d46351c4",
      hex(IteratedS2k.digest("sha384", salt, passphrase, 70_001))
    )
  }

  @Test
  fun hashesAShortCountOnlyInPartOfTheBlockAndNeverLessThanOneWholeCopy() {
    assertEquals(
      "900c3f3673c29422fffb56c1a3388e5ecc264fa81c43ec4c9ae5ed2ce951d6ae",
      hex(IteratedS2k.digest("sha256", salt, passphrase, 1_000))
    )
    // A count below the length of the salt and the passphrase is raised to it, as OpenPGP does.
    assertEquals(
      hex(IteratedS2k.digest("sha256", salt, passphrase, (salt.size + passphrase.size).toLong())),
      hex(IteratedS2k.digest("sha256", salt, passphrase, 5))
    )
  }

  @Test
  fun hashesWithSha1Too() {
    assertEquals(
      "1a05b4fd138d5975cf6391260f5cdb2dc6968a5d",
      hex(IteratedS2k.digest("sha1", salt, passphrase, 65_011_712))
    )
  }

  @Test
  fun refusesAHashThatItDoesNotKnow() {
    assertThrows(IllegalArgumentException::class.java) { IteratedS2k.digest("md5", salt, passphrase, 100) }
  }

  @Test
  fun refusesNothingToHash() {
    assertThrows(IllegalArgumentException::class.java) { IteratedS2k.digest("sha256", ByteArray(0), ByteArray(0), 100) }
  }
}
