package com.peregrinemobile

import android.content.Context

/** Which way the phone is told of new mail at once, if at all. */
enum class PushMode {
  /** The system has a push service: it keeps the connections, and wakes the application. */
  SYSTEM,

  /** The system has none and the user switched it on: the application keeps the connections itself, in a foreground service. */
  DEVICE,

  /** Neither: new mail is found by the schedule of the platform only. */
  OFF
}

/**
 * Sends what JavaScript says to be watched the way that is there: to the push service of the system where the device has
 * one, to the foreground service of the application where it has not and the user asked for it, and nowhere else. What
 * JavaScript says is the same for both, so what follows it is written once.
 */
object PushRouter {
  private const val PREFERENCES = "push"
  private const val KEEP_CONNECTION = "keep_connection"

  private fun preferences(context: Context) = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

  /** Whether the user switched on that the application keeps the connections itself. Used only where there is no system service. */
  fun keepConnection(context: Context): Boolean = preferences(context).getBoolean(KEEP_CONNECTION, false)

  fun mode(context: Context): PushMode =
    when {
      SystemPush.available(context) -> PushMode.SYSTEM
      keepConnection(context) -> PushMode.DEVICE
      else -> PushMode.OFF
    }

  /** Switches the application's own connections on or off. Off takes what was kept for them away, passwords included. */
  fun setKeepConnection(context: Context, on: Boolean) {
    preferences(context).edit().putBoolean(KEEP_CONNECTION, on).apply()
    if (!on) releaseDevice(context)
  }

  fun register(context: Context, source: IdleSource) {
    when (mode(context)) {
      PushMode.SYSTEM -> {
        // A system service that was not there before takes over: what the application kept for itself is not needed.
        releaseDevice(context)
        SystemPush.register(context, source.sourceId, source.host, source.port, source.security, source.username, source.password, source.mailbox)
      }
      PushMode.DEVICE -> {
        IdleRuntime.get(context).store.put(source)
        IdleRuntime.start(context)
      }
      PushMode.OFF -> Unit
    }
  }

  fun unregister(context: Context, sourceId: String) {
    when (mode(context)) {
      PushMode.SYSTEM -> SystemPush.unregister(context, sourceId)
      PushMode.DEVICE -> {
        val store = IdleRuntime.get(context).store
        store.remove(sourceId)
        if (store.list().isEmpty()) releaseDevice(context) else IdleRuntime.start(context)
      }
      PushMode.OFF -> Unit
    }
  }

  fun unregisterAll(context: Context) {
    when (mode(context)) {
      PushMode.SYSTEM -> SystemPush.unregisterAll(context)
      PushMode.DEVICE -> releaseDevice(context)
      PushMode.OFF -> Unit
    }
  }

  /** Ends the foreground service and forgets what it watched. Nothing is left behind that holds a password. */
  private fun releaseDevice(context: Context) {
    IdleRuntime.stop(context)
    if (IdleRuntime.hasSources(context)) IdleRuntime.get(context).store.clear()
  }
}
