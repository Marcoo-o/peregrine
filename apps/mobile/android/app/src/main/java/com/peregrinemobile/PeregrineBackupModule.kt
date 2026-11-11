package com.peregrinemobile

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.util.Base64
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Sealing and opening a backup, which is key derivation of 600000 rounds: a second here and minutes in a script. Content and files cross the bridge as base64, as
 * files do everywhere else. The work is done on a thread of its own, so that the bridge is not held for the second it takes.
 *
 * And what a scheduled backup needs of the device (`AutoBackupStore`, `BackupScheduler`): the folder, the password kept by the Keystore and never handed back, the
 * writing of a file into the folder, and the moment of the next run.
 */
class PeregrineBackupModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "PeregrineBackup"

  /** The promise of the folder that is being chosen, held until the system answers. */
  private var choosing: Promise? = null

  private val listener =
    object : BaseActivityEventListener() {
      override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQUEST_FOLDER) return
        val promise = choosing ?: return
        choosing = null
        val tree = data?.data
        if (resultCode != Activity.RESULT_OK || tree == null) {
          promise.resolve(null)
          return
        }
        try {
          // The permission outlives this process: a scheduled run has to write into the folder when the application is closed.
          context.contentResolver.takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
          val name = tree.lastPathSegment?.substringAfterLast(':')?.ifEmpty { null } ?: tree.toString()
          AutoBackupStore.setFolder(context, tree, name)
          promise.resolve(name)
        } catch (e: Exception) {
          promise.reject("E_BACKUP", e.message ?: "The folder could not be kept", e)
        }
      }
    }

  init {
    context.addActivityEventListener(listener)
  }

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

  /** Lets the user choose the folder the scheduled backups go into. Resolves with its name, or null when none was chosen. */
  @ReactMethod
  fun chooseFolder(promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("E_NO_ACTIVITY", "There is no screen to choose a folder on")
      return
    }
    choosing?.resolve(null)
    choosing = promise
    try {
      val intent =
        Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        }
      activity.startActivityForResult(intent, REQUEST_FOLDER)
    } catch (e: Exception) {
      choosing = null
      promise.reject("E_BACKUP", e.message ?: "The choice of a folder could not be shown", e)
    }
  }

  /** What the folder is called, or null when none is chosen, and whether a password is kept. */
  @ReactMethod
  fun state(promise: Promise) {
    val map = com.facebook.react.bridge.Arguments.createMap()
    map.putString("folder", AutoBackupStore.folderName(context))
    map.putBoolean("hasPassword", AutoBackupStore.hasPassword(context))
    promise.resolve(map)
  }

  /** Keeps the password, sealed by the Keystore. It is never given back: the sealing is done here with it. */
  @ReactMethod
  fun rememberPassword(password: String, promise: Promise) {
    val chars = password.toCharArray()
    try {
      AutoBackupStore.setPassword(context, chars)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("E_BACKUP", e.message ?: "The password could not be kept", e)
    } finally {
      chars.fill(Char.MIN_VALUE)
    }
  }

  @ReactMethod
  fun forgetPassword(promise: Promise) {
    AutoBackupStore.forgetPassword(context)
    promise.resolve(null)
  }

  /** Seals content with the kept password and writes the file into the folder, keeping the newest `keep` automatic backups there. */
  @ReactMethod
  fun sealToFolder(name: String, contentBase64: String, keep: Double, promise: Promise) {
    Thread {
      try {
        val file = AutoBackupStore.seal(context, Base64.decode(contentBase64, Base64.NO_WRAP))
        if (file == null) {
          promise.reject("E_NO_PASSWORD", "There is no password kept for the backups")
          return@Thread
        }
        AutoBackupStore.write(context, name, file, keep.toInt())
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("E_BACKUP", e.message ?: "The backup could not be written", e)
      }
    }.start()
  }

  /** Arms the next scheduled run at a moment, in milliseconds since the epoch; null cancels it. */
  @ReactMethod
  fun arm(atMillis: Double, promise: Promise) {
    BackupScheduler.arm(context, atMillis.toLong())
    promise.resolve(null)
  }

  @ReactMethod
  fun disarm(promise: Promise) {
    BackupScheduler.cancel(context)
    promise.resolve(null)
  }

  /** Runs a scheduled backup now. */
  @ReactMethod
  fun runNow(promise: Promise) {
    BackupScheduler.runNow(context)
    promise.resolve(null)
  }

  companion object {
    private const val REQUEST_FOLDER = 4713
  }
}
