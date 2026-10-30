package com.peregrinemobile

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.view.WindowManager
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * The screen lock of the phone, used as the lock of the application.
 *
 * The application does not ask for a secret of its own: it asks the system for the one the user already has, which is a PIN, a
 * pattern, a password or a biometric, whichever the phone is set to. So there is nothing here to store or to forget, and the application
 * is exactly as hard to open as the phone is. A phone without a screen lock cannot have the application locked, and says so.
 *
 * What the application shows is also kept out of screenshots and out of the list of recent applications while the lock is on.
 */
class PeregrineLockModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {

  private var asking: Promise? = null

  private val listener =
    object : BaseActivityEventListener() {
      override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQUEST_CONFIRM) return
        asking?.resolve(resultCode == Activity.RESULT_OK)
        asking = null
      }
    }

  init {
    context.addActivityEventListener(listener)
  }

  override fun getName() = "PeregrineLock"

  private val keyguard: KeyguardManager
    get() = reactApplicationContext.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager

  /** Whether the phone has a screen lock, which is what the application's lock is. */
  @ReactMethod
  fun available(promise: Promise) {
    promise.resolve(keyguard.isDeviceSecure)
  }

  /** Asks the user for the screen lock of the phone, and says whether it was given. False for anything else: cancelling, or no lock to ask for. */
  @ReactMethod
  @Suppress("DEPRECATION")
  fun authenticate(title: String, description: String, promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("E_NO_ACTIVITY", "There is no screen to ask on")
      return
    }
    if (asking != null) {
      promise.reject("E_BUSY", "The lock is being asked for already")
      return
    }
    val intent = keyguard.createConfirmDeviceCredentialIntent(title, description)
    if (intent == null) {
      // No screen lock: there is nothing to give, and nothing to keep out.
      promise.resolve(false)
      return
    }
    asking = promise
    activity.startActivityForResult(intent, REQUEST_CONFIRM)
  }

  /** Keeps what the application shows out of screenshots and out of the list of recent applications, or lets it be in them again. */
  @ReactMethod
  fun setSecure(on: Boolean, promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.resolve(null)
      return
    }
    activity.runOnUiThread {
      if (on) activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE) else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
      promise.resolve(null)
    }
  }

  private companion object {
    const val REQUEST_CONFIRM = 4713
  }
}
