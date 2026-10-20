package com.peregrinemobile

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters

/** What the scheduler runs: one look for new mail, in JavaScript, which says so in notifications. */
class SyncWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
  override fun doWork(): Result =
    // A run that did not finish in time is tried again later, and not counted as one that worked.
    if (BackgroundSyncRunner.run(applicationContext, inputData.getBoolean(SyncScheduler.FORCE, false))) {
      Result.success()
    } else {
      Result.retry()
    }
}
