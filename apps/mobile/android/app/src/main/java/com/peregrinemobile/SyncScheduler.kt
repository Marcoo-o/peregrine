package com.peregrinemobile

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.PeriodicWorkRequest
import androidx.work.WorkManager
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

  /** Looks for mail once, now, which is what a button for it does. A run that is waiting is not doubled. */
  fun runNow(context: Context) {
    val request = OneTimeWorkRequest.Builder(SyncWorker::class.java).setConstraints(needsNetwork).build()
    WorkManager.getInstance(context).enqueueUniqueWork(ONCE, ExistingWorkPolicy.KEEP, request)
  }
}
