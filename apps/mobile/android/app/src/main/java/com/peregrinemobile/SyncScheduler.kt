package com.peregrinemobile

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequest
import androidx.work.WorkManager
import android.os.Build
import java.util.concurrent.TimeUnit

/**
 * When the application looks for new mail while it is closed: on the platform's own scheduler, which
 * keeps the work across a restart of the phone and runs it when the phone has a network.
 *
 * Not push. The platform does not run periodic work more often than every fifteen minutes, and it runs
 * it when it sees fit: with the phone idle, or the battery low, or the application not used for days, it
 * can be later. That is the price of not keeping a connection open and a notification in the bar.
 */
object SyncScheduler {
  private const val PERIODIC = "peregrine-mail-sync"
  private const val ONCE = "peregrine-mail-sync-now"
  private const val PUSHED = "peregrine-mail-sync-pushed"

  /** The key of the input that says that the look was asked for by the user and is not to be skipped. */
  const val FORCE = "force"

  private val needsNetwork = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

  /** Looks for mail every so often. Called again with another interval, it changes the one that is scheduled. */
  fun schedule(context: Context, minutes: Long) {
    val request =
      PeriodicWorkRequest.Builder(SyncWorker::class.java, SyncInterval.usable(minutes), TimeUnit.MINUTES)
        .setConstraints(needsNetwork)
        .build()
    WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.UPDATE, request)
  }

  fun cancel(context: Context) {
    WorkManager.getInstance(context).cancelUniqueWork(PERIODIC)
  }

  /**
   * Looks for mail once, now, which is what a button for it does. A run that is waiting is not doubled.
   * It is forced: the user asked, so it is not skipped because the application is on the screen.
   */
  fun runNow(context: Context) {
    val request =
      OneTimeWorkRequest.Builder(SyncWorker::class.java)
        .setConstraints(needsNetwork)
        .setInputData(Data.Builder().putBoolean(FORCE, true).build())
        .build()
    WorkManager.getInstance(context).enqueueUniqueWork(ONCE, ExistingWorkPolicy.KEEP, request)
  }

  /**
   * Looks for mail once, now, because the push service of the system said that something happened on a mailbox. It is
   * run as soon as it can be: from Android 12 the work is expedited, which the system runs at once instead of when it
   * sees fit, for as long as the application has quota for it, and as ordinary work when it has none. A wake that comes
   * while a look is under way is put behind it and not dropped: that look may have fetched before the message arrived.
   */
  fun runForPush(context: Context) {
    val builder =
      OneTimeWorkRequest.Builder(SyncWorker::class.java)
        .setConstraints(needsNetwork)
        .setInputData(Data.Builder().putBoolean(FORCE, true).build())
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      builder.setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
    }
    WorkManager.getInstance(context).enqueueUniqueWork(PUSHED, ExistingWorkPolicy.APPEND_OR_REPLACE, builder.build())
  }
}
