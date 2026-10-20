package com.peregrinemobile

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import java.io.File
import java.io.IOException
import java.util.UUID

/**
 * The files of the device, for attachments.
 *
 * Picking copies: a file the user chose is copied into a directory of the application's own at once,
 * and what JavaScript is given is the path of the copy. A message in the queue refers to that path,
 * and the queue may run when the application is started again much later, when the permission to read
 * the file that was picked is gone or the file itself. Every path JavaScript passes back is held to
 * that one directory, see [ConfinedFiles].
 *
 * Saving and opening go the other way. Saving asks the user where, through the system's own dialog,
 * so the application needs no access to any storage. Opening writes the file to the cache and hands
 * it to another application through a content address that is good for that one application and that
 * one file, never a path.
 *
 * Content crosses the bridge as base64, which is what a string can carry.
 */
class PeregrineFilesModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {

  private var picking: Promise? = null
  private var saving: Pair<Promise, ByteArray>? = null

  private val listener =
    object : BaseActivityEventListener() {
      override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        when (requestCode) {
          REQUEST_PICK -> finishPick(resultCode, data)
          REQUEST_SAVE -> finishSave(resultCode, data)
        }
      }
    }

  init {
    context.addActivityEventListener(listener)
  }

  override fun getName() = "PeregrineFiles"

  private val outgoing: File
    get() = File(reactApplicationContext.filesDir, OUTGOING).apply { mkdirs() }

  /** Lets the user pick files and copies them. An empty list when they pick none. */
  @ReactMethod
  fun pick(promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("E_NO_ACTIVITY", "There is no screen to pick a file on")
      return
    }
    if (picking != null) {
      promise.reject("E_BUSY", "A file is being picked already")
      return
    }
    val intent =
      Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = "*/*"
        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
      }
    picking = promise
    try {
      activity.startActivityForResult(intent, REQUEST_PICK)
    } catch (e: ActivityNotFoundException) {
      picking = null
      promise.reject("E_NO_PICKER", "This phone has nothing to pick files with", e)
    }
  }

  private fun finishPick(resultCode: Int, data: Intent?) {
    val promise = picking ?: return
    picking = null
    if (resultCode != Activity.RESULT_OK || data == null) {
      promise.resolve(Arguments.createArray())
      return
    }
    val uris = mutableListOf<Uri>()
    data.clipData?.let { clip -> for (i in 0 until clip.itemCount) uris.add(clip.getItemAt(i).uri) }
    if (uris.isEmpty()) data.data?.let { uris.add(it) }

    // Copying can take a while for a large file, and the main thread is the one drawing the screen.
    Thread {
        try {
          val result = Arguments.createArray()
          for (uri in uris) result.pushMap(copyPicked(uri))
          promise.resolve(result)
        } catch (e: IOException) {
          promise.reject("E_COPY", e.message ?: "The file could not be copied", e)
        }
      }
      .start()
  }

  private fun copyPicked(uri: Uri): com.facebook.react.bridge.WritableMap {
    val resolver = reactApplicationContext.contentResolver
    var name: String? = null
    resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
      if (cursor.moveToFirst()) name = cursor.getString(0)
    }
    val safe = ConfinedFiles.safeName(name ?: uri.lastPathSegment, "datei")
    val directory = File(outgoing, UUID.randomUUID().toString()).apply { mkdirs() }
    val copy = File(directory, safe)
    val input = resolver.openInputStream(uri) ?: throw IOException("The file could not be opened")
    input.use { source -> copy.outputStream().use { target -> source.copyTo(target) } }
    return Arguments.createMap().apply {
      putString("path", copy.path)
      putString("name", safe)
      putDouble("size", copy.length().toDouble())
      putString("mimeType", resolver.getType(uri) ?: "")
    }
  }

  /** The content of a copy, as base64. */
  @ReactMethod
  fun read(path: String, promise: Promise) {
    val file = ConfinedFiles.resolve(outgoing, path)
    if (file == null || !file.isFile) {
      promise.reject("E_NO_FILE", "No such file: $path")
      return
    }
    if (file.length() > MAX_READ_BYTES) {
      promise.reject("E_TOO_LARGE", "The file is too large to be sent")
      return
    }
    Thread {
        try {
          promise.resolve(Base64.encodeToString(file.readBytes(), Base64.NO_WRAP))
        } catch (e: IOException) {
          promise.reject("E_READ", e.message ?: "The file could not be read", e)
        }
      }
      .start()
  }

  /** Deletes copies, and the directory each was made in. Paths that are not copies, or are gone, are left. */
  @ReactMethod
  fun remove(paths: ReadableArray, promise: Promise) {
    val root = outgoing
    for (i in 0 until paths.size()) {
      val file = ConfinedFiles.resolve(root, paths.getString(i) ?: continue) ?: continue
      file.delete()
      file.parentFile?.takeIf { it != root.canonicalFile && it.list()?.isEmpty() == true }?.delete()
    }
    promise.resolve(null)
  }

  /**
   * Removes every copy that is not in the list, which is what the queue still refers to. For what is
   * left behind when a message is discarded, an account is removed or the application stops between
   * picking a file and sending.
   */
  @ReactMethod
  fun keepOnly(paths: ReadableArray, promise: Promise) {
    val keep = (0 until paths.size()).mapNotNull { paths.getString(it) }
    Thread {
        try {
          ConfinedFiles.orphans(outgoing, keep).forEach { it.deleteRecursively() }
          promise.resolve(null)
        } catch (e: SecurityException) {
          promise.reject("E_REMOVE", e.message ?: "The copies could not be removed", e)
        }
      }
      .start()
  }

  /** Lets the user choose where to save a file and writes it there. False when they chose nowhere. */
  @ReactMethod
  fun save(name: String, mimeType: String, base64: String, promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("E_NO_ACTIVITY", "There is no screen to save a file from")
      return
    }
    if (saving != null) {
      promise.reject("E_BUSY", "A file is being saved already")
      return
    }
    val bytes = Base64.decode(base64, Base64.DEFAULT)
    val intent =
      Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = mimeType.ifEmpty { "application/octet-stream" }
        putExtra(Intent.EXTRA_TITLE, ConfinedFiles.safeName(name, "datei"))
      }
    saving = Pair(promise, bytes)
    try {
      activity.startActivityForResult(intent, REQUEST_SAVE)
    } catch (e: ActivityNotFoundException) {
      saving = null
      promise.reject("E_NO_PICKER", "This phone has nothing to save files with", e)
    }
  }

  private fun finishSave(resultCode: Int, data: Intent?) {
    val (promise, bytes) = saving ?: return
    saving = null
    val uri = data?.data
    if (resultCode != Activity.RESULT_OK || uri == null) {
      promise.resolve(false)
      return
    }
    Thread {
        try {
          val output =
            reactApplicationContext.contentResolver.openOutputStream(uri)
              ?: throw IOException("The place could not be written to")
          output.use { it.write(bytes) }
          promise.resolve(true)
        } catch (e: IOException) {
          promise.reject("E_WRITE", e.message ?: "The file could not be written", e)
        }
      }
      .start()
  }

  /** Hands a file to another application to show. */
  @ReactMethod
  fun open(name: String, mimeType: String, base64: String, promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("E_NO_ACTIVITY", "There is no screen to open a file from")
      return
    }
    Thread {
        try {
          val shared = File(reactApplicationContext.cacheDir, SHARED)
          removeOld(shared)
          val directory = File(shared, UUID.randomUUID().toString()).apply { mkdirs() }
          val file = File(directory, ConfinedFiles.safeName(name, "datei"))
          file.writeBytes(Base64.decode(base64, Base64.DEFAULT))
          val uri =
            FileProvider.getUriForFile(reactApplicationContext, "${reactApplicationContext.packageName}.files", file)
          val intent =
            Intent(Intent.ACTION_VIEW).apply {
              setDataAndType(uri, mimeType.ifEmpty { "application/octet-stream" })
              addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
          activity.runOnUiThread {
            try {
              activity.startActivity(intent)
              promise.resolve(null)
            } catch (e: ActivityNotFoundException) {
              promise.reject("E_NO_HANDLER", "No application on this phone can open this file", e)
            }
          }
        } catch (e: IOException) {
          promise.reject("E_WRITE", e.message ?: "The file could not be prepared", e)
        }
      }
      .start()
  }

  /** What was handed over earlier is not needed for long, and is not left to pile up in the cache. */
  private fun removeOld(directory: File) {
    val limit = System.currentTimeMillis() - ONE_DAY_MS
    directory.listFiles()?.forEach { if (it.lastModified() < limit) it.deleteRecursively() }
  }

  companion object {
    private const val OUTGOING = "outgoing"
    private const val SHARED = "shared"
    private const val REQUEST_PICK = 4711
    private const val REQUEST_SAVE = 4712
    private const val MAX_READ_BYTES = 64L * 1024 * 1024
    private const val ONE_DAY_MS = 24L * 60 * 60 * 1000
  }
}
