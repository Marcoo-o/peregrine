package com.peregrinemobile

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class ConfinedFilesTest {
  @get:Rule val folder = TemporaryFolder()

  private fun root(): File = folder.newFolder("outgoing")

  @Test
  fun a_file_inside_the_root_is_resolved() {
    val root = root()
    val inside = File(root, "one/a.pdf").apply { parentFile?.mkdirs(); writeText("x") }
    assertEquals(inside.canonicalFile, ConfinedFiles.resolve(root, inside.path))
  }

  @Test
  fun a_path_that_leaves_the_root_by_dots_is_refused() {
    val root = root()
    val outside = folder.newFile("secret.db")
    assertNull(ConfinedFiles.resolve(root, root.path + "/../secret.db"))
    assertNull(ConfinedFiles.resolve(root, File(root, "one/../../secret.db").path))
    assertTrue(outside.exists())
  }

  @Test
  fun a_file_somewhere_else_is_refused() {
    val root = root()
    assertNull(ConfinedFiles.resolve(root, folder.newFile("other.txt").path))
  }

  @Test
  fun the_root_itself_and_a_sibling_that_starts_the_same_way_are_refused() {
    val root = root()
    val sibling = folder.newFolder("outgoing-more")
    assertNull(ConfinedFiles.resolve(root, root.path))
    assertNull(ConfinedFiles.resolve(root, File(sibling, "a.txt").path))
  }

  @Test
  fun an_empty_path_is_refused() {
    assertNull(ConfinedFiles.resolve(root(), ""))
  }

  @Test
  fun a_link_inside_the_root_that_points_outside_is_refused() {
    val root = root()
    val target = folder.newFile("target.txt")
    val link = File(root, "link.txt")
    try {
      java.nio.file.Files.createSymbolicLink(link.toPath(), target.toPath())
    } catch (e: Exception) {
      // a file system or a user that may not make links has nothing to be tested here
      return
    }
    assertNull(ConfinedFiles.resolve(root, link.path))
  }

  @Test
  fun a_name_loses_its_path_and_what_a_file_system_refuses() {
    assertEquals("_.._etc_passwd", ConfinedFiles.safeName("../../etc/passwd", "file"))
    assertEquals("a_b_c.txt", ConfinedFiles.safeName("a:b*c.txt", "file"))
    assertEquals("evil_.dll", ConfinedFiles.safeName("evil\u0001.dll", "file"))
  }

  @Test
  fun a_name_loses_leading_dots_and_trailing_dots_and_spaces() {
    assertEquals("hidden", ConfinedFiles.safeName(".hidden", "file"))
    assertEquals("evil.exe", ConfinedFiles.safeName("evil.exe. .", "file"))
  }

  @Test
  fun a_name_with_nothing_left_is_the_fallback() {
    assertEquals("file", ConfinedFiles.safeName("...", "file"))
    assertEquals("file", ConfinedFiles.safeName(null, "file"))
    assertEquals("file", ConfinedFiles.safeName("", "file"))
  }

  @Test
  fun a_long_name_keeps_its_extension() {
    val name = ConfinedFiles.safeName("a".repeat(300) + ".pdf", "file")
    assertEquals(120, name.length)
    assertTrue(name.endsWith(".pdf"))
    assertNotNull(name)
  }

  @Test
  fun an_ordinary_name_is_left_alone() {
    assertEquals("Rechnung März 2026.pdf", ConfinedFiles.safeName("Rechnung März 2026.pdf", "file"))
  }
}
