package com.peregrinemobile

import android.content.Context
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Runs the task `PeregrineSync` that JavaScript registered, without a screen, and waits until it is done.
 *
 * It does what `HeadlessJsTaskService` of React Native does, but from the scheduler's job and not from a
 * service. A service could not be started from here on a phone that has the application in the background:
 * the system refuses that, and a job is where it is not refused. The React instance is started when there is
 * none, and used when the application is open. The task is told apart from the others by the number it
 * is given, and its end is the callback React Native makes when the promise of the task is settled, so
 * JavaScript has nothing of its own to report.
 */
object BackgroundSyncRunner {
  private const val TASK_KEY = "PeregrineSync"

  /** React stops the instance after this whatever the task does, against one that never ends. */
  private const val TASK_TIMEOUT_MS = 3 * 60 * 1000L

  /** How long the job waits. A little longer than the task, which ends by itself first. */
  private const val WAIT_MINUTES = 4L

  /**
   * Returns whether the task finished before it was given up on. Called on the scheduler's thread.
   * [force] is passed to the task, which then looks though the application is on the screen.
   */
  fun run(context: Context, force: Boolean): Boolean {
    val finished = CountDownLatch(1)
    UiThreadUtil.runOnUiThread { prepare(context, force, finished) }
    return finished.await(WAIT_MINUTES, TimeUnit.MINUTES)
  }

  private fun prepare(context: Context, force: Boolean, finished: CountDownLatch) {
    val host =
      checkNotNull((context.applicationContext as ReactApplication).reactHost) {
        "The application has no React host to run the look for mail in"
      }
    val current = host.currentReactContext
    if (current != null) {
      start(current, force, finished)
      return
    }
    host.addReactInstanceEventListener(
      object : ReactInstanceEventListener {
        override fun onReactContextInitialized(context: ReactContext) {
          host.removeReactInstanceEventListener(this)
          start(context, force, finished)
        }
      }
    )
    host.start()
  }

  private fun start(reactContext: ReactContext, force: Boolean, finished: CountDownLatch) {
    val tasks = HeadlessJsTaskContext.getInstance(reactContext)
    // Allowed on the screen too: the application may be open, and the task then does nothing and ends.
    val data = Arguments.createMap().apply { putBoolean("force", force) }
    val config = HeadlessJsTaskConfig(TASK_KEY, data, TASK_TIMEOUT_MS, true)
    tasks.addTaskEventListener(
      object : HeadlessJsTaskEventListener {
        private var mine = -1

        override fun onHeadlessJsTaskStart(taskId: Int) {
          if (mine == -1) mine = taskId
        }

        override fun onHeadlessJsTaskFinish(taskId: Int) {
          if (taskId != mine) return
          tasks.removeTaskEventListener(this)
          finished.countDown()
        }
      }
    )
    UiThreadUtil.runOnUiThread { tasks.startTask(config) }
  }
}
