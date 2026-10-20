package com.peregrinemobile

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/** Showing notifications about new mail. What they say is decided in JavaScript, which has the rules. */
object MailNotifications {
  private const val CHANNEL_ID = "mail"

  /** What a notification is made of, as JavaScript gives it. */
  data class Content(
    val accountId: String,
    val title: String,
    val body: String,
    val subtitle: String?,
    val count: Int,
    val target: LaunchTarget.Target
  )

  /** The id a notification for an account has, the same each time: a new one replaces the one before. */
  fun idFor(accountId: String): Int = accountId.hashCode()

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    // The name is what the user sees in the system's settings for the application.
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "Neue Nachrichten", NotificationManager.IMPORTANCE_DEFAULT)
    )
  }

  /** Whether the system lets the application show notifications at all. */
  fun areEnabled(context: Context): Boolean = NotificationManagerCompat.from(context).areNotificationsEnabled()

  fun show(context: Context, content: Content) {
    ensureChannel(context)
    val id = idFor(content.accountId)
    val builder =
      NotificationCompat.Builder(context, CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_notification)
        .setContentTitle(content.title)
        .setContentText(content.body)
        .setSubText(content.subtitle)
        .setNumber(content.count)
        .setCategory(NotificationCompat.CATEGORY_EMAIL)
        .setAutoCancel(true)
        .setContentIntent(opening(context, id, content.target))
        // On a locked screen the system shows the public version: which account and how many, and not
        // who wrote and what about, which anybody who picks up the phone could read.
        .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
        .setPublicVersion(
          NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(content.subtitle ?: content.title)
            .setContentText(if (content.count == 1) "1 neue Nachricht" else "${content.count} neue Nachrichten")
            .build()
        )
    NotificationManagerCompat.from(context).notify(id, builder.build())
  }

  fun clearAll(context: Context) {
    NotificationManagerCompat.from(context).cancelAll()
  }

  /** What a tap leads to: the application, with the message in the extras. */
  private fun opening(context: Context, id: Int, target: LaunchTarget.Target): PendingIntent {
    val intent =
      Intent(context, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        putExtra(LaunchTarget.EXTRA_ACCOUNT, target.accountId)
        putExtra(LaunchTarget.EXTRA_FOLDER, target.folderId)
        putExtra(LaunchTarget.EXTRA_UID, target.uid)
      }
    // The id is the request code, so that each account has its own, and the extras are replaced by the
    // newest message when one is already there.
    return PendingIntent.getActivity(context, id, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }
}
