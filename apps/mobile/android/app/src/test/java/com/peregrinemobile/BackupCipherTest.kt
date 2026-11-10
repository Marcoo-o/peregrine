package com.peregrinemobile

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class BackupCipherTest {
  private val password = "secret".toCharArray()
  private val salt = ByteArray(16) { it.toByte() }
  private val iv = ByteArray(12) { (100 + it).toByte() }

  private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }

  // The file that `packages/core/src/backupFormat.test.ts` makes with Node for the same rounds, salt, IV, password and content: both sides have to write exactly this.
  private val vector = "5047424b31000003e8000102030405060708090a0b0c0d0e0f6465666768696a6b6c6d6e6fa8e216204591b0d5549d5608575045b02f2730b405afbd574a"

  private fun fromHex(text: String) = ByteArray(text.length / 2) { text.substring(it * 2, it * 2 + 2).toInt(16).toByte() }

  @Test
  fun writesTheFileThatNodeWritesForTheSameInput() {
    assertEquals(vector, hex(BackupCipher.seal("peregrine".toByteArray(), password, 1000, salt, iv)))
  }

  @Test
  fun readsTheFileThatNodeWrites() {
    assertEquals("peregrine", String(BackupCipher.open(fromHex(vector), password)!!))
  }

  @Test
  fun opensWhatItSealedAndOnlyWithThePassword() {
    val file = BackupCipher.seal("the accounts".toByteArray(), password, 1000)
    assertArrayEquals("the accounts".toByteArray(), BackupCipher.open(file, password))
    assertNull(BackupCipher.open(file, "wrong".toCharArray()))
  }

  @Test
  fun doesNotOpenAFileThatWasChangedInTheBodyOrTheHeader() {
    val file = BackupCipher.seal("content".toByteArray(), password, 1000)
    for (at in listOf(file.size - 1, 29, 7, 12)) {
      val changed = file.copyOf()
      changed[at] = (changed[at].toInt() xor 1).toByte()
      assertNull(BackupCipher.open(changed, password))
    }
  }

  @Test
  fun doesNotOpenAFileWhoseRoundsWereLowered() {
    val file = BackupCipher.seal("content".toByteArray(), password, 2000)
    val lowered = file.copyOf()
    lowered[7] = 0x03
    lowered[8] = 0xe8.toByte()
    assertNull(BackupCipher.open(lowered, password))
  }

  @Test
  fun refusesWhatIsNotABackupIsCutOffOrAsksForTooManyRounds() {
    assertNull(BackupCipher.open("not a backup at all, but long enough to be read as one".toByteArray(), password))
    assertNull(BackupCipher.open(ByteArray(10), password))
    val file = BackupCipher.seal("content".toByteArray(), password, 1000)
    assertNull(BackupCipher.open(file.copyOf(30), password))
    val greedy = file.copyOf()
    greedy[5] = 0x00
    greedy[6] = 0x4c
    greedy[7] = 0x4b
    greedy[8] = 0x41
    assertNull(BackupCipher.open(greedy, password))
    assertNotNull(BackupCipher.open(file, password))
  }
}
