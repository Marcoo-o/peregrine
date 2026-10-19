package com.peregrinemobile

import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.IOException
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import javax.net.ssl.SSLSocket

/**
 * The phone's `Transport` from @peregrine/imap: a TCP connection, with TLS from the start or
 * upgraded in place, that reads and writes bytes and says when it is over.
 *
 * What it promises is what `NodeTransport` promises on the desktop. The certificate is checked
 * against the host that was asked for ([TlsUpgrade]), there is no way to switch that off, and
 * anything that arrived over the clear connection and was not delivered before an upgrade is
 * thrown away, because it was sent before encryption and cannot be believed.
 *
 * Bytes cross to JavaScript as base64, which costs a third more and spares a binary channel the
 * platform does not have in a form this old. Received data comes as events, in order. Everything
 * else is a call that answers once.
 */
class PeregrineTransportModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {

  private val connections = ConcurrentHashMap<Int, Connection>()
  private val ids = AtomicInteger(1)
  private val workers = Executors.newCachedThreadPool()

  override fun getName() = "PeregrineTransport"

  @ReactMethod
  fun connect(host: String, port: Int, tls: Boolean, promise: Promise) {
    workers.execute {
      var plain: Socket? = null
      try {
        plain = Socket()
        plain.tcpNoDelay = true
        plain.connect(InetSocketAddress(host, port), CONNECT_TIMEOUT_MS)
        val socket: Socket = if (tls) TlsUpgrade.secure(plain, host) else plain
        val connection = Connection(ids.getAndIncrement(), socket)
        connections[connection.id] = connection
        // Nothing is read yet. The server's greeting can arrive before JavaScript has the number
        // of the connection and somewhere to put what comes, and it would be lost. JavaScript
        // calls [start] when it is ready.
        promise.resolve(connection.id)
      } catch (e: Exception) {
        plain?.closeQuietly()
        promise.reject("E_CONNECT", describe(e), e)
      }
    }
  }

  /** Begins reading, once the caller has the number of the connection and is listening. */
  @ReactMethod
  fun start(id: Int) {
    connections[id]?.startReading()
  }

  @ReactMethod
  fun startTls(id: Int, host: String, promise: Promise) {
    val connection = connections[id]
    if (connection == null) {
      promise.reject("E_CLOSED", "The connection is closed")
      return
    }
    workers.execute {
      try {
        connection.upgrade(host)
        promise.resolve(null)
      } catch (e: Exception) {
        // A failed upgrade never falls back to the clear connection.
        connection.close(describe(e))
        promise.reject("E_TLS", describe(e), e)
      }
    }
  }

  @ReactMethod
  fun write(id: Int, base64: String, promise: Promise) {
    val connection = connections[id]
    if (connection == null) {
      promise.reject("E_CLOSED", "The connection is closed")
      return
    }
    val bytes = Base64.decode(base64, Base64.NO_WRAP)
    // One writer per connection keeps what is written in the order it was asked for.
    try {
      connection.writer.execute {
        try {
          connection.output().write(bytes)
          connection.output().flush()
          promise.resolve(null)
        } catch (e: IOException) {
          promise.reject("E_WRITE", describe(e), e)
        }
      }
    } catch (e: RejectedExecutionException) {
      // The connection ended between looking it up and writing to it.
      promise.reject("E_CLOSED", "The connection is closed")
    }
  }

  @ReactMethod
  fun close(id: Int) {
    connections[id]?.close(null)
  }

  // Required of a module that JavaScript listens to through NativeEventEmitter. The events are
  // sent whether anybody listens or not.
  @ReactMethod fun addListener(eventName: String) {}

  @ReactMethod fun removeListeners(count: Int) {}

  override fun invalidate() {
    connections.values.forEach { it.close(null) }
    workers.shutdownNow()
    super.invalidate()
  }

  private fun emit(event: String, id: Int, data: String?, error: String?) {
    if (!context.hasActiveReactInstance()) return
    val payload = Arguments.createMap()
    payload.putInt("id", id)
    if (data != null) payload.putString("data", data)
    if (error != null) payload.putString("error", error)
    context
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(event, payload)
  }

  private inner class Connection(val id: Int, @Volatile var socket: Socket) {
    val writer = Executors.newSingleThreadExecutor()
    private val ended = AtomicBoolean(false)
    @Volatile private var reader: Thread? = null
    @Volatile private var stopReading = false
    private val canPoll: Boolean get() = socket !is SSLSocket

    fun output() = socket.getOutputStream()

    /**
     * A clear connection is read with a short timeout so the reading can be stopped between two
     * reads, which is what an upgrade needs: it cannot start while somebody else is reading from
     * the same socket. An encrypted one blocks, and is never upgraded again.
     */
    fun startReading() {
      stopReading = false
      val current = socket
      if (canPoll) current.soTimeout = POLL_INTERVAL_MS
      val thread =
        Thread({ readLoop(current) }, "peregrine-transport-$id").apply { isDaemon = true }
      reader = thread
      thread.start()
    }

    private fun readLoop(current: Socket) {
      val buffer = ByteArray(16 * 1024)
      try {
        val input = current.getInputStream()
        while (!stopReading) {
          val count =
            try {
              input.read(buffer)
            } catch (e: SocketTimeoutException) {
              if (current is SSLSocket) throw e
              continue
            }
          if (count < 0) {
            finish(null)
            return
          }
          emit(DATA_EVENT, id, Base64.encodeToString(buffer, 0, count, Base64.NO_WRAP), null)
        }
      } catch (e: IOException) {
        // Closing the socket from this side makes the read fail, and that is not an error.
        if (!ended.get() && !stopReading) finish(describe(e))
      }
    }

    fun upgrade(host: String) {
      // The clear connection stops being read before the handshake starts, and the reader has
      // really stopped, so that it cannot take a byte of the handshake for data.
      stopReading = true
      reader?.join(UPGRADE_WAIT_MS)
      if (reader?.isAlive == true) throw IOException("The connection could not be paused")
      val secured = TlsUpgrade.secure(socket, host)
      socket = secured
      startReading()
    }

    fun close(error: String?) {
      stopReading = true
      socket.closeQuietly()
      finish(error)
    }

    private fun finish(error: String?) {
      if (!ended.compareAndSet(false, true)) return
      connections.remove(id)
      writer.shutdown()
      emit(CLOSE_EVENT, id, null, error)
    }
  }

  private fun describe(e: Exception): String = e.message ?: e.javaClass.simpleName

  private fun Socket.closeQuietly() {
    try {
      close()
    } catch (_: IOException) {}
  }

  companion object {
    const val DATA_EVENT = "PeregrineTransportData"
    const val CLOSE_EVENT = "PeregrineTransportClose"
    private const val CONNECT_TIMEOUT_MS = 30_000
    private const val POLL_INTERVAL_MS = 100
    private const val UPGRADE_WAIT_MS = 2_000L
  }
}
