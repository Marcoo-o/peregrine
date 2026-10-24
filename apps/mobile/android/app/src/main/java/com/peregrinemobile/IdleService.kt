package com.peregrinemobile

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * What the phone holds itself to watch the inboxes while it is closed, on a device that has no push service of the system: the
 * sources, the watchers and the gate that lets a change through to the look for mail. One for the process.
 */
class IdleRuntime private constructor(private val context: Context) {
  private val log =
    object : IdleLog {
      override fun info(message: String) {
        Log.i(TAG, message)
      }

      override fun warn(message: String) {
        Log.w(TAG, message)
      }
    }

  val store = IdleSourceStore(sourceFile(context), KeystoreSecretBox(), log)

  private val later =
    Executors.newSingleThreadScheduledExecutor { task -> Thread(task, "look for mail later").apply { isDaemon = true } }

  /** Mail comes in bursts: one look finds what several changes were about, so a look is started at most so often. */
  private val gate =
    WakeGate(
      WAKE_GAP_MILLIS,
      System::currentTimeMillis,
      { task, delay -> later.schedule(task, delay, TimeUnit.MILLISECONDS) },
      {
        Log.i(TAG, "something happened on a server, looking for mail")
        SyncScheduler.runForPush(context)
      }
    )

  val watchers =
    IdleWatchers(
      SocketIdleConnection.FACTORY,
      { gate.request() },
      IdleBackoff.standard(),
      System::currentTimeMillis,
      log,
      IdleSession.DEFAULT_RENEW_MILLIS
    )

  companion object {
    const val TAG = "PeregrineIdle"

    /** The least time between two looks that the service starts. */
    const val WAKE_GAP_MILLIS = 10_000L

    @Volatile private var instance: IdleRuntime? = null

    fun get(context: Context): IdleRuntime =
      instance ?: synchronized(this) { instance ?: IdleRuntime(context.applicationContext).also { instance = it } }

    private fun sourceFile(context: Context) = File(context.filesDir, "idle_sources.json")

    /** Whether there is anything kept to watch, without reading it (which would need the key). */
    fun hasSources(context: Context): Boolean = sourceFile(context).exists()

    /** Starts the service, or tells the one that runs to read the sources again. From the screen or from the boot, where that is allowed. */
    fun start(context: Context) {
      try {
        ContextCompat.startForegroundService(context, Intent(context, IdleService::class.java))
      } catch (error: RuntimeException) {
        // The system refuses it when the application is in the background, which it is not when the user switches this on.
        Log.w(TAG, "the service could not be started: ${error.javaClass.simpleName}")
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, IdleService::class.java))
    }
  }
}

/**
 * The foreground service that keeps the connections open: an ordinary service with a notification that says so, which is what
 * the system wants of anything that is to go on in the background for as long as the user has not stopped it. Its type is
 * special use: nothing else fits a connection that waits for mail, and the other types end after hours on Android 15.
 */
class IdleService : Service() {
  private var network: ConnectivityManager.NetworkCallback? = null

  override fun onCreate() {
    super.onCreate()
    enterForeground()
    val connectivity = getSystemService(ConnectivityManager::class.java)
    val callback =
      object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
          IdleRuntime.get(this@IdleService).watchers.networkAvailable()
        }
      }
    try {
      connectivity?.registerDefaultNetworkCallback(callback)
      network = callback
    } catch (error: RuntimeException) {
      Log.w(IdleRuntime.TAG, "the network cannot be watched: ${error.javaClass.simpleName}")
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // A start command may come again (a source was added or taken away): the foreground state is kept, and what is watched is read anew.
    enterForeground()
    val runtime = IdleRuntime.get(this)
    runtime.watchers.apply(runtime.store.list())
    Log.i(IdleRuntime.TAG, "watching ${runtime.watchers.count()} inboxes")
    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    network?.let { getSystemService(ConnectivityManager::class.java)?.unregisterNetworkCallback(it) }
    IdleRuntime.get(this).watchers.stopAll()
    super.onDestroy()
  }

  private fun enterForeground() {
    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL_ID) == null) {
      // Quiet: it is there to say that the phone waits for mail, and has nothing to say beyond that.
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Verbindung für neue Nachrichten", NotificationManager.IMPORTANCE_LOW)
      )
    }
    val open =
      PendingIntent.getActivity(
        this,
        0,
        Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
      )
    val notification =
      NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_notification)
        .setContentTitle("Peregrine wartet auf neue Nachrichten")
        .setContentText("Ausschalten: Einstellungen, Sofort benachrichtigen")
        .setContentIntent(open)
        .setOngoing(true)
        .setNotificationSilent()
        .setOnlyAlertOnce(true)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .build()
    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
    ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)
  }

  private companion object {
    const val CHANNEL_ID = "connection"
    const val NOTIFICATION_ID = 7001
  }
}

/** Starts the service again after the phone was started or the application was updated, where it was on. */
class IdleBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (PushRouter.mode(context) == PushMode.DEVICE && IdleRuntime.hasSources(context)) IdleRuntime.start(context)
  }
}
