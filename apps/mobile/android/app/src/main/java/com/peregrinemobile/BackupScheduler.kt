package com.peregrinemobile

import android.content.Context
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequest
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/** What the scheduler runs for a scheduled backup: JavaScript makes it (it knows what is in the database), and the native side seals and writes it. */
class BackupWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
  override fun doWork(): Result =
    // A run that did not finish in time is tried again later and not counted as one that worked.
    if (BackgroundSyncRunner.run(applicationContext, force = true, taskKey = BackupScheduler.TASK_KEY)) Result.success() else Result.retry()
}

/**
 * When the next scheduled backup runs. JavaScript says the moment (it is worked out from the schedule the user chose, a weekday and a time, which is a matter of the
 * calendar and is tested there) and this arms it on the platform's scheduler, which keeps it across a restart of the phone. The run arms the next one itself when it
 * is done, so there is only ever one waiting.
 */
object BackupScheduler {
  /** The task JavaScript registered, which is `registerAutoBackup.ts`. */
  const val TASK_KEY = "PeregrineBackup"
  private const val WORK = "peregrine-auto-backup"

  /** Arms the run at a moment, in milliseconds since the epoch. One that was armed is replaced. */
  fun arm(context: Context, atMillis: Long) {
    val delay = maxOf(atMillis - System.currentTimeMillis(), 0L)
    val request = OneTimeWorkRequest.Builder(BackupWorker::class.java).setInitialDelay(delay, TimeUnit.MILLISECONDS).build()
    WorkManager.getInstance(context).enqueueUniqueWork(WORK, ExistingWorkPolicy.REPLACE, request)
  }

  fun cancel(context: Context) {
    WorkManager.getInstance(context).cancelUniqueWork(WORK)
  }

  /** A run now: what a button for it does. */
  fun runNow(context: Context) = arm(context, 0L)
}
