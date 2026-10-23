package com.peregrinemobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * What the push service of the system wakes when something happened on a source it watches for this application. It
 * looks for mail, as the scheduler does, only now: the look itself and the notifications it leads to are the same.
 *
 * The manifest protects it with a permission that only the service holds, so nothing else can wake it. Where the
 * system has no such service the permission is not defined, and the receiver cannot be reached by anybody.
 */
class PushWakeReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    SyncScheduler.runForPush(context)
  }
}
