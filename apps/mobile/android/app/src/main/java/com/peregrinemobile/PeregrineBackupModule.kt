package com.peregrinemobile

import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Sealing and opening a backup, which is key derivation of 600000 rounds: a second here and minutes in a script. Content and files cross the bridge as base64, as
 * files do everywhere else. The work is done on a thread of its own, so that the bridge is not held for the second it takes.
 */
class PeregrineBackupModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "PeregrineBackup"

  /** The file for the content, as base64. */
  @ReactMethod
  fun seal(contentBase64: String, password: String, promise: Promise) {
    Thread {
      val chars = password.toCharArray()
      try {
        val file = BackupCipher.seal(Base64.decode(contentBase64, Base64.NO_WRAP), chars)
        promise.resolve(Base64.encodeToString(file, Base64.NO_WRAP))
      } catch (e: Exception) {
        promise.reject("E_BACKUP", e.message ?: "The backup could not be sealed", e)
      } finally {
        chars.fill(Char.MIN_VALUE)
      }
    }.start()
  }

  /** The content of a file as base64, or null when the password is wrong, the file was changed, or it is not a backup. */
  @ReactMethod
  fun open(fileBase64: String, password: String, promise: Promise) {
    Thread {
      val chars = password.toCharArray()
      try {
        val content = BackupCipher.open(Base64.decode(fileBase64, Base64.NO_WRAP), chars)
        promise.resolve(content?.let { Base64.encodeToString(it, Base64.NO_WRAP) })
      } catch (e: Exception) {
        promise.reject("E_BACKUP", e.message ?: "The backup could not be opened", e)
      } finally {
        chars.fill(Char.MIN_VALUE)
      }
    }.start()
  }
}
