package com.peregrinemobile

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener

/** The notifications of the application: the permission to show them, showing one, and where a tap led. */
class PeregrineNotificationsModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {

  private var asking: Promise? = null

  override fun getName() = "PeregrineNotifications"

  /** Whether notifications may be shown now, without asking. */
  @ReactMethod
  fun permitted(promise: Promise) {
    promise.resolve(isPermitted())
  }

  /**
   * Whether notifications may be shown, asking for the permission when there is none to ask for first.
   * From Android 13 the permission is one the user is asked for, and the answer is what is returned.
   */
  @ReactMethod
  fun ensurePermission(promise: Promise) {
    if (isPermitted()) {
      promise.resolve(true)
      return
    }
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      // Below 13 nothing is asked: the user has switched them off in the system's settings.
      promise.resolve(false)
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
    activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_CODE, listener)
  }

  private fun isPermitted(): Boolean {
    val context = reactApplicationContext
    val granted =
      Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
          PackageManager.PERMISSION_GRANTED
    return granted && MailNotifications.areEnabled(context)
  }

  @ReactMethod
  fun show(options: ReadableMap, promise: Promise) {
    val target = options.getMap("target")
    val content =
      MailNotifications.Content(
        accountId = options.getString("accountId") ?: "",
        title = options.getString("title") ?: "",
        body = options.getString("body") ?: "",
        subtitle = if (options.hasKey("subtitle")) options.getString("subtitle") else null,
        count = options.getInt("count"),
        target =
          LaunchTarget.Target(
            target?.getString("accountId") ?: "",
            target?.getString("folderId") ?: "",
            target?.getInt("uid") ?: -1
          )
      )
    try {
      MailNotifications.show(reactApplicationContext, content)
      promise.resolve(null)
    } catch (e: SecurityException) {
      // The permission was taken away between the check and now.
      promise.reject("E_NOT_PERMITTED", e.message ?: "Notifications are not permitted", e)
    }
  }

  @ReactMethod
  fun clearAll(promise: Promise) {
    MailNotifications.clearAll(reactApplicationContext)
    promise.resolve(null)
  }

  /** The message a notification was tapped for, once, or null when there is none. */
  @ReactMethod
  fun consumeLaunchTarget(promise: Promise) {
    val target = LaunchTarget.consume()
    if (target == null) {
      promise.resolve(null)
      return
    }
    promise.resolve(
      Arguments.createMap().apply {
        putString("accountId", target.accountId)
        putString("folderId", target.folderId)
        putInt("uid", target.uid)
      }
    )
  }

  companion object {
    private const val REQUEST_CODE = 4713
  }
}
