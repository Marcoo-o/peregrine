package com.peregrinemobile

import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.concurrent.Executors

/**
 * What OpenPGP has to do that a script does too slowly: the hash that makes a key of the passphrase of a sealed private key.
 * Only the salt, the passphrase and the number of bytes cross over, and the hash comes back, not the tens of megabytes it is made of.
 */
class PeregrinePgpModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  /** One at a time, off the thread of the script: the hash takes a moment and the screen draws meanwhile. */
  private val worker = Executors.newSingleThreadExecutor()

  override fun getName() = "PeregrinePgp"

  /** The hash of the iterated and salted string-to-key, as base64. The salt and the passphrase are given as base64 too. */
  @ReactMethod
  fun iteratedS2k(algorithm: String, saltBase64: String, passphraseBase64: String, count: Double, promise: Promise) {
    worker.execute {
      try {
        val salt = Base64.decode(saltBase64, Base64.NO_WRAP)
        val passphrase = Base64.decode(passphraseBase64, Base64.NO_WRAP)
        promise.resolve(Base64.encodeToString(IteratedS2k.digest(algorithm, salt, passphrase, count.toLong()), Base64.NO_WRAP))
      } catch (e: IllegalArgumentException) {
        promise.reject("E_S2K", e.message, e)
      }
    }
  }
}
