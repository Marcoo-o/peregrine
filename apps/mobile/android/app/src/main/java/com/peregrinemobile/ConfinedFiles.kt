package com.peregrinemobile

import java.io.File

/**
 * Where the copies of picked files live, and the rule that nothing outside is touched.
 *
 * The paths come from JavaScript, which means from a queued message and, behind it, from whatever
 * was stored. A module that reads and deletes whatever path it is given would read and delete any file
 * of the application, its database included, for anything that could put a path there. So every path
 * is resolved to its canonical form, with `..` and links followed, and has to end up below the one
 * directory the copies are made in.
 */
object ConfinedFiles {
  /** The file at [path] if it lies inside [root], and null for anything else, [root] itself included. */
  fun resolve(root: File, path: String): File? {
    if (path.isEmpty()) return null
    val base = root.canonicalFile
    val candidate = File(path).canonicalFile
    return if (candidate.path.startsWith(base.path + File.separator)) candidate else null
  }

  private const val MAX_LENGTH = 120
  private val FORBIDDEN = "/\\:*?\"<>|"

  /**
   * A name that can be written to a file system, made of what a message or a file provider called a
   * file: no path, no characters a file system refuses, no control characters, no leading dots, which
   * would hide it, and no trailing dots or spaces. The extension survives when it is too long.
   */
  fun safeName(proposed: String?, fallback: String): String {
    val replaced =
      (proposed ?: "")
        .map { if (it in FORBIDDEN || it.code < 0x20 || it.code == 0x7f) '_' else it }
        .joinToString("")
    val cleaned = replaced.trimStart('.').trimEnd('.', ' ').trim()
    if (cleaned.isEmpty()) return fallback
    if (cleaned.length <= MAX_LENGTH) return cleaned
    val dot = cleaned.lastIndexOf('.')
    val extension = if (dot > 0) cleaned.substring(dot, minOf(cleaned.length, dot + 12)) else ""
    return cleaned.substring(0, MAX_LENGTH - extension.length) + extension
  }
}
