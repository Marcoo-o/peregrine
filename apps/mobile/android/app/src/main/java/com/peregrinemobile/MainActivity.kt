package com.peregrinemobile

import android.content.Intent
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "Peregrine"

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    LaunchTarget.remember(targetOf(intent))
  }

  /** The activity is brought forward by a tap on a notification when it is running already. */
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    LaunchTarget.remember(targetOf(intent))
  }

  private fun targetOf(intent: Intent?): LaunchTarget.Target? =
    LaunchTarget.fromExtras(
      intent?.getStringExtra(LaunchTarget.EXTRA_ACCOUNT),
      intent?.getStringExtra(LaunchTarget.EXTRA_FOLDER),
      intent?.getIntExtra(LaunchTarget.EXTRA_UID, -1) ?: -1
    )

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
