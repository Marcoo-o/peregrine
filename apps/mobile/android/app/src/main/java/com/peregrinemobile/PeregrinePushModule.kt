package com.peregrinemobile

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/** Telling the push service of the system what to watch for this application, where the system has one. */
class PeregrinePushModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {

  override fun getName() = "PeregrinePush"

  /** Whether the device has a push service. */
  @ReactMethod
  fun available(promise: Promise) {
    promise.resolve(SystemPush.available(reactApplicationContext))
  }

  /** Has the service watch a mailbox, and wake this application when it changes. The same source id replaces the one before. */
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
    SystemPush.register(reactApplicationContext, sourceId, host, port.toInt(), security, username, password, mailbox)
    promise.resolve(null)
  }

  @ReactMethod
  fun unregister(sourceId: String, promise: Promise) {
    SystemPush.unregister(reactApplicationContext, sourceId)
    promise.resolve(null)
  }

  @ReactMethod
  fun unregisterAll(promise: Promise) {
    SystemPush.unregisterAll(reactApplicationContext)
    promise.resolve(null)
  }
}
