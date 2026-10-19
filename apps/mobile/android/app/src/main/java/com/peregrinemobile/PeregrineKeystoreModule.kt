package com.peregrinemobile

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.security.GeneralSecurityException
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The passphrase of the encrypted database, and where it lives.
 *
 * It is 32 random bytes made once. They are never kept as they are: an AES key that never leaves
 * the Android Keystore wraps them, and only the wrapped form is written to the app's private
 * storage. A copy of the database file, or of the app's data, is therefore useless without the
 * Keystore of this phone.
 *
 * The key is not tied to the screen being unlocked or to a fingerprint. The application has to
 * open its own database in the background, for a sync with nobody there, and that is what this
 * trades away: it protects the data at rest, and does not protect against code running inside
 * the application itself.
 *
 * The desktop keeps the equivalent in Electron's `safeStorage`. This is its counterpart here.
 */
class PeregrineKeystoreModule(context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {

  override fun getName() = "PeregrineKeystore"

  /** The passphrase as 64 hexadecimal characters, made on the first call. */
  @ReactMethod
  fun getDatabasePassphrase(promise: Promise) {
    try {
      promise.resolve(getOrCreatePassphrase(reactApplicationContext))
    } catch (e: GeneralSecurityException) {
      // The wrapped passphrase is there and the key that wraps it is not, for instance after a
      // restore onto another phone. The database cannot be read, and saying so is the only
      // honest thing: a new passphrase would silently make a new, empty database.
      promise.reject("E_KEY_UNAVAILABLE", "The database key is unavailable", e)
    } catch (e: IllegalStateException) {
      promise.reject("E_KEY_STORE", e.message, e)
    }
  }

  companion object {
    private const val KEY_ALIAS = "peregrine_database_wrapper_key"
    private const val TRANSFORMATION =
      "${KeyProperties.KEY_ALGORITHM_AES}/${KeyProperties.BLOCK_MODE_GCM}/${KeyProperties.ENCRYPTION_PADDING_NONE}"
    private const val PREFERENCES = "peregrine_database_key"
    private const val WRAPPED = "wrapped_passphrase"
    private const val IV_BYTES = 12
    private const val PASSPHRASE_BYTES = 32
    private const val TAG_BITS = 128

    // Two first calls at once must not make two passphrases.
    private val lock = Any()

    fun getOrCreatePassphrase(context: Context): String =
      synchronized(lock) {
        val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
        preferences.getString(WRAPPED, null)?.let {
          return unwrap(it)
        }
        val raw = ByteArray(PASSPHRASE_BYTES).also { SecureRandom().nextBytes(it) }
        val passphrase = raw.joinToString("") { "%02x".format(it) }
        // commit(), not apply(): the passphrase has to be on disk before a database is created
        // with it. If the process died in between, the database would exist and its passphrase
        // would be gone for good.
        check(preferences.edit().putString(WRAPPED, wrap(passphrase)).commit()) {
          "could not store the database passphrase"
        }
        passphrase
      }

    private fun key(): SecretKey {
      val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
      (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let {
        return it
      }
      val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
      generator.init(
        KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
          )
          .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
          .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
          .build()
      )
      return generator.generateKey()
    }

    private fun wrap(plain: String): String {
      val cipher = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, key()) }
      val sealed = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
      return Base64.encodeToString(cipher.iv + sealed, Base64.NO_WRAP)
    }

    private fun unwrap(payload: String): String {
      val all = Base64.decode(payload, Base64.NO_WRAP)
      val cipher =
        Cipher.getInstance(TRANSFORMATION).apply {
          init(
            Cipher.DECRYPT_MODE,
            key(),
            GCMParameterSpec(TAG_BITS, all.copyOfRange(0, IV_BYTES)),
          )
        }
      return String(cipher.doFinal(all.copyOfRange(IV_BYTES, all.size)), Charsets.UTF_8)
    }
  }
}
