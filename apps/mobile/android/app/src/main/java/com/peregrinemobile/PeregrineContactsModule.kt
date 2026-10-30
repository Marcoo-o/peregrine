package com.peregrinemobile

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.ContactsContract
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener

/**
 * The address book of the device, to suggest people when an address is typed.
 *
 * Only what is asked for leaves it: the addresses that match a typed part, a handful at a time. Nothing is copied
 * into the application's database, so a person who is taken out of the address book is not suggested any more.
 */
class PeregrineContactsModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {

  private var asking: Promise? = null

  override fun getName() = "PeregrineContacts"

  private fun isPermitted(): Boolean =
    ContextCompat.checkSelfPermission(reactApplicationContext, Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED

  /** Whether the address book may be read now, without asking. */
  @ReactMethod
  fun permitted(promise: Promise) {
    promise.resolve(isPermitted())
  }

  /** Whether it may be read, asking the user for the permission first when there is none. */
  @ReactMethod
  fun ensurePermission(promise: Promise) {
    if (isPermitted()) {
      promise.resolve(true)
      return
    }
    val activity = reactApplicationContext.currentActivity as? PermissionAwareActivity
    if (activity == null) {
      promise.reject("E_NO_ACTIVITY", "There is no screen to ask for the permission on")
      return
    }
    if (asking != null) {
      promise.reject("E_BUSY", "The permission is being asked for already")
      return
    }
    asking = promise
    val listener = PermissionListener { requestCode, _, results ->
      if (requestCode != REQUEST_CODE) return@PermissionListener false
      asking?.resolve(results.firstOrNull() == PackageManager.PERMISSION_GRANTED)
      asking = null
      true
    }
    activity.requestPermissions(arrayOf(Manifest.permission.READ_CONTACTS), REQUEST_CODE, listener)
  }

  /** The addresses whose name or address begins a word with [typed], at most [limit], with the name they are saved under. */
  @ReactMethod
  fun search(typed: String, limit: Int, promise: Promise) {
    if (!isPermitted() || typed.isBlank()) {
      promise.resolve(Arguments.createArray())
      return
    }
    Thread {
        try {
          val found = Arguments.createArray()
          val uri = Uri.withAppendedPath(ContactsContract.CommonDataKinds.Email.CONTENT_FILTER_URI, Uri.encode(typed.trim()))
          val projection =
            arrayOf(ContactsContract.CommonDataKinds.Email.DISPLAY_NAME_PRIMARY, ContactsContract.CommonDataKinds.Email.ADDRESS)
          val seen = HashSet<String>()
          reactApplicationContext.contentResolver
            .query(uri, projection, null, null, "${ContactsContract.CommonDataKinds.Email.DISPLAY_NAME_PRIMARY} COLLATE LOCALIZED ASC")
            ?.use { cursor ->
              while (cursor.moveToNext() && seen.size < limit) {
                val address = cursor.getString(1)?.trim() ?: continue
                if (address.isEmpty() || !seen.add(address.lowercase())) continue
                found.pushMap(
                  Arguments.createMap().apply {
                    putString("name", cursor.getString(0)?.trim() ?: "")
                    putString("address", address)
                  }
                )
              }
            }
          promise.resolve(found)
        } catch (e: SecurityException) {
          // The permission was taken back while this ran: nobody is suggested.
          promise.resolve(Arguments.createArray())
        } catch (e: RuntimeException) {
          promise.reject("E_CONTACTS", e.message ?: "The address book could not be read", e)
        }
      }
      .start()
  }

  private companion object {
    const val REQUEST_CODE = 4712
  }
}
