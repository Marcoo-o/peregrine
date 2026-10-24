package com.peregrinemobile

import android.content.ActivityNotFoundException
import android.content.Intent
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Telling the phone what to watch for new mail while it is closed: the push service of the system where the device has one,
 * and otherwise the foreground service of the application, if the user switched that on. Which of them it is, is decided
 * here (`PushRouter`) and not in JavaScript.
 */
class PeregrinePushModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {

  override fun getName() = "PeregrinePush"

  /** Whether there is a way that the phone is told at once: the push service of the system, or the user's own connections. */
  @ReactMethod
  fun available(promise: Promise) {
    promise.resolve(PushRouter.mode(reactApplicationContext) != PushMode.OFF)
  }

  /** What there is: whether the system has a push service, and whether the user switched on the application's own connections. */
  @ReactMethod
  fun state(promise: Promise) {
    val state = Arguments.createMap()
    state.putBoolean("system", SystemPush.available(reactApplicationContext))
    state.putBoolean("keepConnection", PushRouter.keepConnection(reactApplicationContext))
    promise.resolve(state)
  }

  /** Switches the application's own connections on or off. They are used only where the system has no push service. */
  @ReactMethod
  fun setKeepConnection(on: Boolean, promise: Promise) {
    PushRouter.setKeepConnection(reactApplicationContext, on)
    promise.resolve(null)
  }

  /**
   * Opens the system's list of the applications that are free of the limits of the resting phone: where the connections hold
   * best. The list is a screen of the system's settings, and a device that has none is no reason for an error.
   */
  @ReactMethod
  fun openBatterySettings(promise: Promise) {
    try {
      reactApplicationContext.startActivity(
        Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      )
    } catch (missing: ActivityNotFoundException) {
      // Nothing to open on this device.
    }
    promise.resolve(null)
  }

  /** Has the mailbox watched, and the application looked for mail when it changes. The same source id replaces the one before. */
  @ReactMethod
  fun register(
    sourceId: String,
    host: String,
    port: Double,
    security: String,
    username: String,
    password: String,
    mailbox: String,
    promise: Promise
  ) {
    PushRouter.register(reactApplicationContext, IdleSource(sourceId, host, port.toInt(), security, username, password, mailbox))
    promise.resolve(null)
  }

  @ReactMethod
  fun unregister(sourceId: String, promise: Promise) {
    PushRouter.unregister(reactApplicationContext, sourceId)
    promise.resolve(null)
  }

  @ReactMethod
  fun unregisterAll(promise: Promise) {
    PushRouter.unregisterAll(reactApplicationContext)
    promise.resolve(null)
  }
}
