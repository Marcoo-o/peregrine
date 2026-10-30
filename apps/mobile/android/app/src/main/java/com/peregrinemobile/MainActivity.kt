package com.peregrinemobile

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.core.content.IntentCompat
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
    IncomingRequest.remember(requestOf(intent))
  }

  /** The activity is brought forward by a tap on a notification when it is running already. */
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    LaunchTarget.remember(targetOf(intent))
    IncomingRequest.remember(requestOf(intent))
  }

  private fun targetOf(intent: Intent?): LaunchTarget.Target? =
    LaunchTarget.fromExtras(
      intent?.getStringExtra(LaunchTarget.EXTRA_ACCOUNT),
      intent?.getStringExtra(LaunchTarget.EXTRA_FOLDER),
      intent?.getIntExtra(LaunchTarget.EXTRA_UID, -1) ?: -1
    )

  /**
   * What another application asked with an intent: a link to an address, or something it shared. Text and addresses are taken
   * as they are, and the shared files by their addresses, of which only those that [IncomingRequest.readableStream] allows.
   */
  private fun requestOf(intent: Intent?): IncomingRequest.Request? {
    if (intent == null) return null
    val action = intent.action
    val mailto = IncomingRequest.mailtoOf(action, intent.dataString)
    val shared = action == Intent.ACTION_SEND || action == Intent.ACTION_SEND_MULTIPLE
    if (mailto == null && !shared) return null
    val streams = mutableListOf<Uri>()
    if (shared) {
      if (action == Intent.ACTION_SEND) {
        IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)?.let { streams.add(it) }
      } else {
        IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)?.let { streams.addAll(it) }
      }
    }
    val own = "$packageName.files"
    return IncomingRequest.Request(
      mailto = mailto,
      subject = intent.getStringExtra(Intent.EXTRA_SUBJECT) ?: "",
      text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString() ?: "",
      to = intent.getStringArrayExtra(Intent.EXTRA_EMAIL)?.toList() ?: emptyList(),
      cc = intent.getStringArrayExtra(Intent.EXTRA_CC)?.toList() ?: emptyList(),
      bcc = intent.getStringArrayExtra(Intent.EXTRA_BCC)?.toList() ?: emptyList(),
      streams = streams.map { it.toString() }.filter { IncomingRequest.readableStream(it, own) },
      refused = streams.count { !IncomingRequest.readableStream(it.toString(), own) }
    )
  }

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
