package com.peregrinemobile

import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** What the names of the automatic backups begin with, so that pruning touches those and no other file in the folder. */
const val AUTO_BACKUP_PREFIX = "peregrine-backup-auto-"

/** The names to delete so that only the newest [keep] automatic backups remain. Other files are never listed. */
fun backupsToDelete(names: List<String>, keep: Int): List<String> =
  names.filter { it.startsWith(AUTO_BACKUP_PREFIX) }.sortedDescending().drop(maxOf(keep, 1))

/**
 * What the scheduled backup needs of the device, kept where JavaScript does not have to: the folder the user chose (through the Storage Access Framework, whose
 * permission outlives the application's process) and the password of the files, sealed with a key of the Android Keystore. The password is entered once, and is
 * never handed back to JavaScript: the sealing of a backup is done here with it. The files themselves open with that password on any phone (see [BackupCipher]).
 */
object AutoBackupStore {
  private const val PREFS = "peregrine_auto_backup"
  private const val KEY_ALIAS = "peregrine_auto_backup_password"

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun folder(context: Context): Uri? = prefs(context).getString("folder", null)?.let(Uri::parse)

  /** What the folder is called, for the screen. */
  fun folderName(context: Context): String? = prefs(context).getString("folder_name", null)

  fun setFolder(context: Context, uri: Uri, name: String) {
    prefs(context).edit().putString("folder", uri.toString()).putString("folder_name", name).apply()
  }

  fun hasPassword(context: Context): Boolean = prefs(context).contains("password")

  fun setPassword(context: Context, password: CharArray) {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
    val sealed = cipher.doFinal(String(password).toByteArray(Charsets.UTF_8))
    prefs(context).edit().putString("password", Base64.encodeToString(cipher.iv + sealed, Base64.NO_WRAP)).apply()
  }

  /** The password, or null when there is none or the key that sealed it is gone (a restore of the phone does not bring the Keystore along). */
  fun password(context: Context): CharArray? {
    val raw = prefs(context).getString("password", null) ?: return null
    return try {
      val all = Base64.decode(raw, Base64.NO_WRAP)
      val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, all.copyOfRange(0, 12))) }
      String(cipher.doFinal(all, 12, all.size - 12), Charsets.UTF_8).toCharArray()
    } catch (_: Exception) {
      null
    }
  }

  fun forgetPassword(context: Context) {
    prefs(context).edit().remove("password").apply()
  }

  private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
    val spec =
      KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build()
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply { init(spec) }.generateKey()
  }

  /** Seals content with the stored password, or null when there is none. */
  fun seal(context: Context, content: ByteArray): ByteArray? {
    val password = password(context) ?: return null
    return try {
      BackupCipher.seal(content, password)
    } finally {
      password.fill(Char.MIN_VALUE)
    }
  }

  /**
   * Writes a file into the folder and keeps the newest [keep] automatic backups there. A file that could not be written whole is deleted again, since an empty or
   * cut-off file would count as the newest and push a good one out when the old ones are pruned.
   */
  fun write(context: Context, name: String, bytes: ByteArray, keep: Int) {
    val tree = folder(context) ?: throw IllegalStateException("No folder is chosen for the backups")
    val resolver = context.contentResolver
    val parent = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
    val file = DocumentsContract.createDocument(resolver, parent, "application/octet-stream", name) ?: throw IllegalStateException("The file could not be made in the folder")
    try {
      resolver.openOutputStream(file)?.use { it.write(bytes) } ?: throw IllegalStateException("The file could not be written")
    } catch (e: Exception) {
      try {
        DocumentsContract.deleteDocument(resolver, file)
      } catch (_: Exception) {
      }
      throw e
    }
    prune(context, tree, keep)
  }

  private fun prune(context: Context, tree: Uri, keep: Int) {
    val resolver = context.contentResolver
    val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
    val documents = mutableMapOf<String, Uri>()
    resolver.query(children, arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)?.use {
      while (it.moveToNext()) documents[it.getString(1)] = DocumentsContract.buildDocumentUriUsingTree(tree, it.getString(0))
    }
    backupsToDelete(documents.keys.toList(), keep).forEach { name ->
      try {
        DocumentsContract.deleteDocument(resolver, documents.getValue(name))
      } catch (_: Exception) {
      }
    }
  }
}
