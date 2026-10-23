package com.peregrinemobile

import android.app.BroadcastOptions
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build

/**
 * The push service of the system, where there is one: a service on the device that keeps connections open for the
 * applications and wakes an application when something happens on one of them. The phone talks to it by broadcasts, and
 * to nobody else: no server of our own, no push service of the platform.
 *
 * Where the system has none, [available] is false, nothing is sent, and the application looks for mail on the schedule
 * of the platform, as it did before.
 */
object SystemPush {
  /** The package of the service and its receiver of registrations. */
  private const val PACKAGE = "org.frogger.push"
  private const val RECEIVER = "org.frogger.push.RegistrationReceiver"

  const val ACTION_REGISTER = "org.frogger.push.action.REGISTER"
  const val ACTION_UNREGISTER = "org.frogger.push.action.UNREGISTER"
  const val ACTION_UNREGISTER_ALL = "org.frogger.push.action.UNREGISTER_ALL"

  /** The receiver the service wakes, by the name it is given when a source is registered. */
  const val WAKE_RECEIVER = "com.peregrinemobile.PushWakeReceiver"

  /**
   * Whether the device has the service. Asked of the package manager, which is told of the package by `queries` in the
   * manifest. Not before Android 14: the service learns who sent a registration from the system, which only tells it of
   * a sender that shares its identity, and that is from that version on.
   */
  fun available(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return false
    return try {
      context.packageManager.getReceiverInfo(ComponentName(PACKAGE, RECEIVER), 0)
      true
    } catch (missing: PackageManager.NameNotFoundException) {
      false
    }
  }

  /**
   * An application that was only installed, or that the user stopped, does not get broadcasts until it is started. The
   * service is to be started by a registration, so that one is let through to a service that was stopped.
   */
  private fun intent(action: String): Intent =
    Intent(action).setComponent(ComponentName(PACKAGE, RECEIVER)).addFlags(Intent.FLAG_INCLUDE_STOPPED_PACKAGES)

  /**
   * Sends to the service, saying who sent it: the service takes the application from the system and never from what is
   * written in the intent, so a registration can only be for the application that sends it. It cannot be sent without that.
   */
  private fun send(context: Context, intent: Intent) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return
    val options = BroadcastOptions.makeBasic().setShareIdentityEnabled(true)
    context.sendBroadcast(intent, null, options.toBundle())
  }

  fun register(
    context: Context,
    sourceId: String,
    host: String,
    port: Int,
    security: String,
    username: String,
    password: String,
    mailbox: String
  ) {
    send(
      context,
      intent(ACTION_REGISTER)
        .putExtra("source_id", sourceId)
        .putExtra("kind", "imap-idle")
        .putExtra("host", host)
        .putExtra("port", port)
        .putExtra("security", security)
        .putExtra("username", username)
        .putExtra("password", password)
        .putExtra("mailbox", mailbox)
        .putExtra("wake_receiver", WAKE_RECEIVER)
    )
  }

  fun unregister(context: Context, sourceId: String) {
    send(context, intent(ACTION_UNREGISTER).putExtra("source_id", sourceId))
  }

  fun unregisterAll(context: Context) {
    send(context, intent(ACTION_UNREGISTER_ALL))
  }
}
