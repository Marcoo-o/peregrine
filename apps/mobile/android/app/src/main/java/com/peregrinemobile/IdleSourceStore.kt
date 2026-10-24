package com.peregrinemobile

import android.security.keystore.KeyGenParameterSpec
import android.util.Base64
import android.security.keystore.KeyProperties
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.nio.ByteBuffer
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/** Seals a secret for the file it is kept in, and opens it again. */
interface SecretBox {
  fun seal(plain: String): String

  fun open(sealed: String): String
}

/**
 * Seals with AES-GCM under a key that lives in the Android Keystore and never leaves it. The passwords of the accounts are in
 * the file of the sources only in this form.
 */
class KeystoreSecretBox : SecretBox {
  private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    if (store.containsAlias(ALIAS)) return store.getKey(ALIAS, null) as SecretKey
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(
      KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build()
    )
    return generator.generateKey()
  }

  override fun seal(plain: String): String {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key())
    val iv = cipher.iv
    val sealed = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
    val joined = ByteBuffer.allocate(1 + iv.size + sealed.size)
    joined.put(iv.size.toByte()).put(iv).put(sealed)
    return Base64.encodeToString(joined.array(), Base64.NO_WRAP)
  }

  override fun open(sealed: String): String {
    val joined = ByteBuffer.wrap(Base64.decode(sealed, Base64.NO_WRAP))
    val iv = ByteArray(joined.get().toInt())
    joined.get(iv)
    val body = ByteArray(joined.remaining())
    joined.get(body)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, iv))
    return String(cipher.doFinal(body), Charsets.UTF_8)
  }

  private companion object {
    const val ALIAS = "peregrine-idle-sources"
    const val TAG_BITS = 128
  }
}

/**
 * The sources the phone watches itself, in a file that survives a restart of the phone: this is what the service starts
 * from after the system has ended it, since nothing else holds the passwords at that time. The passwords are sealed in it.
 * Written whole to a new file and moved over the old one, so that a power cut leaves the one or the other and never half
 * of one.
 */
class IdleSourceStore(private val file: File, private val box: SecretBox, private val log: IdleLog) {
  private val items = LinkedHashMap<String, IdleSource>()
  private var loaded = false

  @Synchronized
  fun list(): List<IdleSource> {
    load()
    return items.values.toList()
  }

  /** Adds the source or replaces the one for the same account. Returns whether the stored set changed. */
  @Synchronized
  fun put(source: IdleSource): Boolean {
    load()
    val before = items.put(source.sourceId, source)
    if (source == before) return false
    try {
      save()
    } catch (error: IOException) {
      // What is in memory is what is in the file.
      if (before == null) items.remove(source.sourceId) else items[source.sourceId] = before
      throw error
    }
    return true
  }

  @Synchronized
  fun remove(sourceId: String): Boolean {
    load()
    if (items.remove(sourceId) == null) return false
    save()
    return true
  }

  /** Forgets all of them, and the file with them. */
  @Synchronized
  fun clear() {
    load()
    items.clear()
    if (file.exists() && !file.delete()) throw IOException("the sources could not be removed")
  }

  private fun load() {
    if (loaded) return
    loaded = true
    if (!file.exists()) return
    try {
      val array = JSONObject(file.readText(Charsets.UTF_8)).getJSONArray("items")
      for (i in 0 until array.length()) {
        val item = array.getJSONObject(i)
        try {
          val source =
            IdleSource(
              item.getString("source_id"),
              item.getString("host"),
              item.getInt("port"),
              item.getString("security"),
              item.getString("username"),
              box.open(item.getString("password")),
              item.getString("mailbox")
            )
          items[source.sourceId] = source
        } catch (error: Exception) {
          // One that cannot be read is lost, and the others are not: the app tells the service of it again at its next start.
          log.warn("a source could not be read and was dropped: ${error.javaClass.simpleName}")
        }
      }
    } catch (error: IOException) {
      log.warn("the sources could not be read: ${error.javaClass.simpleName}")
    } catch (error: JSONException) {
      log.warn("the sources could not be read: ${error.javaClass.simpleName}")
    }
  }

  private fun save() {
    val array = JSONArray()
    for (source in items.values) {
      array.put(
        JSONObject()
          .put("source_id", source.sourceId)
          .put("host", source.host)
          .put("port", source.port)
          .put("security", source.security)
          .put("username", source.username)
          .put("password", box.seal(source.password))
          .put("mailbox", source.mailbox)
      )
    }
    val root = JSONObject().put("version", 1).put("items", array)
    val temporary = File(file.path + ".new")
    FileOutputStream(temporary).use { out ->
      out.write(root.toString().toByteArray(Charsets.UTF_8))
      out.fd.sync()
    }
    if (!temporary.renameTo(file)) {
      // A rename that may not replace a file (some file systems, and Windows, where the tests run): the old one goes first.
      // Not atomic then, but the new one is complete and in place before the old one is gone from the memory of anybody.
      if (file.exists() && !file.delete()) throw IOException("the sources could not be written")
      if (!temporary.renameTo(file)) throw IOException("the sources could not be written")
    }
  }
}
