package com.peregrinemobile

import java.io.File
import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class IdleSourceStoreTest {
  @get:Rule val folder = TemporaryFolder()

  /** Seals by reversing, which is enough to tell sealed text from plain text. */
  private val box =
    object : SecretBox {
      override fun seal(plain: String) = "sealed:" + plain.reversed()

      override fun open(sealed: String): String {
        require(sealed.startsWith("sealed:")) { "not sealed" }
        return sealed.removePrefix("sealed:").reversed()
      }
    }

  private fun source(id: String, password: String) = IdleSource(id, "imap.example.org", 993, "tls", "alex", password, "INBOX")

  private fun store(file: File) = IdleSourceStore(file, box, IdleLog.None)

  @Test
  fun keepsSourcesAcrossARestart() {
    val file = File(folder.root, "sources.json")
    val first = store(file)
    first.put(source("a", "secret"))
    first.put(source("b", "other"))
    val again = store(file).list()
    assertEquals(2, again.size)
    assertEquals("secret", again[0].password)
    assertEquals("b", again[1].sourceId)
  }

  @Test
  fun writesThePasswordSealedAndNeverInThePlain() {
    val file = File(folder.root, "sources.json")
    store(file).put(source("a", "hunter2"))
    val content = file.readText()
    assertFalse(content.contains("hunter2"))
    assertTrue(content.contains("sealed:"))
  }

  @Test
  fun replacesTheSourceOfTheSameAccountAndSaysWhetherAnythingChanged() {
    val store = store(File(folder.root, "s.json"))
    assertTrue(store.put(source("a", "one")))
    assertTrue(store.put(source("a", "two")))
    assertFalse("the same again changes nothing", store.put(source("a", "two")))
    assertEquals(listOf("two"), store.list().map { it.password })
  }

  @Test
  fun removesOneSourceAndClearsAllWithTheFile() {
    val file = File(folder.root, "s.json")
    val store = store(file)
    store.put(source("a", "x"))
    store.put(source("b", "x"))
    assertTrue(store.remove("a"))
    assertFalse(store.remove("a"))
    assertEquals(listOf("b"), store(file).list().map { it.sourceId })
    store.clear()
    assertFalse("nothing that holds a password is left", file.exists())
    assertEquals(0, store.list().size)
  }

  @Test
  fun startsEmptyWhenThereIsNoFileOrItCannotBeRead() {
    assertEquals(0, store(File(folder.root, "none.json")).list().size)
    val broken = folder.newFile("broken.json").apply { writeText("{ not json") }
    assertEquals(0, store(broken).list().size)
  }

  @Test
  fun dropsOnlyTheSourceThatCannotBeOpenedAndKeepsTheOthers() {
    val file = File(folder.root, "s.json")
    val first = store(file)
    first.put(source("a", "x"))
    first.put(source("b", "y"))
    file.writeText(file.readText().replaceFirst("sealed:x", "damaged"))
    assertEquals(listOf("b"), store(file).list().map { it.sourceId })
  }

  @Test
  fun keepsMemoryAsTheFileWhenWritingFails() {
    val directory = folder.newFolder("gone")
    val file = File(directory, "s.json")
    val store = store(file)
    store.put(source("a", "x"))
    assertTrue(file.delete())
    assertTrue(directory.delete())
    try {
      store.put(source("b", "y"))
      fail("the write should have failed")
    } catch (expected: IOException) {
      assertEquals(1, store.list().size)
    }
  }
}
