package com.peregrinemobile

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/** Looking for new mail while the application is closed: when, and now. The look itself is JavaScript. */
class PeregrineSyncModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {

  override fun getName() = "PeregrineSync"

  /** Looks for mail every [minutes] minutes, and at least every fifteen. Changes the interval when there is one. */
  @ReactMethod
  fun schedule(minutes: Double, promise: Promise) {
    SyncScheduler.schedule(reactApplicationContext, minutes.toLong())
    promise.resolve(null)
  }

  @ReactMethod
  fun cancel(promise: Promise) {
    SyncScheduler.cancel(reactApplicationContext)
    promise.resolve(null)
  }

  /** Looks for mail once, now. */
  @ReactMethod
  fun runNow(promise: Promise) {
    SyncScheduler.runNow(reactApplicationContext)
    promise.resolve(null)
  }
}
