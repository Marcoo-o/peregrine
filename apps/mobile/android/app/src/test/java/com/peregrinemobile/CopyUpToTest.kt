package com.peregrinemobile

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class CopyUpToTest {
  private fun copy(content: ByteArray, limit: Long): ByteArray {
    val out = ByteArrayOutputStream()
    PeregrineFilesModule.copyUpTo(ByteArrayInputStream(content), out, limit)
    return out.toByteArray()
  }

  @Test
  fun a_file_below_the_limit_is_copied_whole() {
    val content = ByteArray(200_000) { (it % 251).toByte() }
    assertArrayEquals(content, copy(content, 1_000_000))
  }

  @Test
  fun a_file_above_the_limit_is_copied_to_the_limit_and_no_further() {
    assertEquals(150_001, copy(ByteArray(10_000_000), 150_001).size)
  }

  @Test
  fun a_file_of_exactly_the_limit_is_copied_whole_and_an_empty_one_is_empty() {
    assertEquals(65_536, copy(ByteArray(65_536), 65_536).size)
    assertEquals(0, copy(ByteArray(0), 100).size)
  }
}
