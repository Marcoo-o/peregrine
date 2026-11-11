package com.peregrinemobile

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters

/**
 * The buttons of a notification that act on its message without opening the application: "Archive" and "Mark read". A button sends a broadcast to
 * [NotificationActionReceiver], which takes the notification away at once (so that it is seen to have worked) and hands the doing to the scheduler, which runs
 * the task JavaScript registered (`registerNotificationAction.ts`): JavaScript knows the database, the folders and the queue that tells the server.
 * ("Reply" is not here: it opens the application on an answer, which is [LaunchTarget].)
 */
object NotificationActions {
  /** The task JavaScript registered. */
  const val TASK_KEY = "PeregrineNotificationAction"

  const val ARCHIVE = "archive"
  const val READ = "read"

  private const val EXTRA_ACTION = "peregrine.action"
  private const val EXTRA_NOTIFICATION = "peregrine.notificationId"

  /** What a button does when it is pressed: the broadcast, for one action on one message. */
  fun pending(context: Context, notificationId: Int, action: String, target: LaunchTarget.Target): PendingIntent {
    val intent =
      Intent(context, NotificationActionReceiver::class.java).apply {
        this.action = "$action:${target.accountId}:${target.folderId}:${target.uid}"
        putExtra(EXTRA_ACTION, action)
        putExtra(EXTRA_NOTIFICATION, notificationId)
        putExtra(LaunchTarget.EXTRA_ACCOUNT, target.accountId)
        putExtra(LaunchTarget.EXTRA_FOLDER, target.folderId)
        putExtra(LaunchTarget.EXTRA_UID, target.uid)
      }
    // The action of the intent is what tells two buttons apart for the system, so each message and each button has its own.
    return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  /** What the scheduler is told: the action and the message, as plain values the work can carry. */
  fun dataOf(action: String, target: LaunchTarget.Target): Data =
    Data.Builder()
      .putString("action", action)
      .putString("accountId", target.accountId)
      .putString("folderId", target.folderId)
      .putInt("uid", target.uid)
      .build()

  /** Whether an action is one of the two the task knows. */
  fun isKnown(action: String?): Boolean = action == ARCHIVE || action == READ

  /**
   * The system lets a job use the network only when the job says it needs it: without that, a task started from a notification while the application is in the
   * background finds no network (found on a device: the connection failed at once with only the name of the host). From Android 12 the work is expedited, which the
   * system runs at once for as long as the application has quota, and as ordinary work when it has none. Without a network the work waits for one, and is kept
   * across a restart of the phone: the button was pressed, and the notification is gone, so it is to be done when it can be.
   */
  fun start(context: Context, action: String, target: LaunchTarget.Target) {
    val builder =
      OneTimeWorkRequest.Builder(NotificationActionWorker::class.java)
        .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
        .setInputData(dataOf(action, target))
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      builder.setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
    }
    WorkManager.getInstance(context).enqueue(builder.build())
  }

  fun targetOf(intent: Intent): LaunchTarget.Target? =
    LaunchTarget.fromExtras(
      intent.getStringExtra(LaunchTarget.EXTRA_ACCOUNT),
      intent.getStringExtra(LaunchTarget.EXTRA_FOLDER),
      intent.getIntExtra(LaunchTarget.EXTRA_UID, -1)
    )

  fun actionOf(intent: Intent): String? = intent.getStringExtra(EXTRA_ACTION)

  fun notificationOf(intent: Intent): Int? = if (intent.hasExtra(EXTRA_NOTIFICATION)) intent.getIntExtra(EXTRA_NOTIFICATION, 0) else null
}

/** Receives the press of a button of a notification. */
class NotificationActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = NotificationActions.actionOf(intent)
    val target = NotificationActions.targetOf(intent)
    if (!NotificationActions.isKnown(action) || target == null) return
    // Away at once: what the button did is not waited for, and a notification that stays after it was pressed looks as if it had not worked.
    NotificationActions.notificationOf(intent)?.let { androidx.core.app.NotificationManagerCompat.from(context).cancel(it) }
    NotificationActions.start(context, action!!, target)
  }
}

/** Runs the task for a button, in the scheduler, where the phone is kept awake until it is done. */
class NotificationActionWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
  override fun doWork(): Result {
    val uid = inputData.getInt("uid", -1)
    val extras =
      mapOf<String, Any>(
        "action" to (inputData.getString("action") ?: ""),
        "accountId" to (inputData.getString("accountId") ?: ""),
        "folderId" to (inputData.getString("folderId") ?: ""),
        "uid" to uid
      )
    // A run that did not finish in time is tried again, and the change it made to the local copy is the same the second time.
    return if (BackgroundSyncRunner.run(applicationContext, force = true, taskKey = NotificationActions.TASK_KEY, extras = extras)) Result.success() else Result.retry()
  }
}
