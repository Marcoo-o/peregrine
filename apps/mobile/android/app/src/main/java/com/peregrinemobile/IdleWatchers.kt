package com.peregrinemobile

import java.io.IOException
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/** Where the watchers write down what they did and what went wrong. Never a password. */
interface IdleLog {
  fun info(message: String)

  fun warn(message: String)

  object None : IdleLog {
    override fun info(message: String) = Unit

    override fun warn(message: String) = Unit
  }
}

/** What is watched: the inbox of an account, and how to get into it. */
data class IdleSource(
  /** The account, so that the same account is the same source. */
  val sourceId: String,
  val host: String,
  val port: Int,
  val security: String,
  val username: String,
  val password: String,
  val mailbox: String
) {
  /** For the log: never the password. */
  override fun toString() = "$sourceId ($host:$port $security as $username, $mailbox)"
}

/** How long a watcher waits before it tries again, by what went wrong and how often in a row. */
class IdleBackoff(
  /** The pauses after a connection that failed, by how many failed in a row; the last one is kept from then on. */
  private val steps: LongArray,
  /** After the login was refused: long, since a wrong password only gets more wrong, and may lock the account. */
  val afterAuthFailure: Long,
  /** After the server turned out not to IDLE. */
  val afterUnsupported: Long,
  /** A connection that lasted this long was a good one: the pauses begin from the first again. */
  val counted: Long
) {
  fun after(failures: Int): Long = steps[minOf(maxOf(failures, 0), steps.size - 1)]

  companion object {
    fun standard(): IdleBackoff {
      val second = 1000L
      val minute = 60 * second
      return IdleBackoff(longArrayOf(5 * second, 15 * second, 45 * second, 2 * minute, 5 * minute), 30 * minute, 30 * minute, minute)
    }
  }
}

/**
 * Watches one source, on a thread of its own, for as long as it is not stopped: connects, waits in IDLE, tells of a change,
 * and when the connection ends, waits and connects again.
 */
class IdleWatcher(
  val source: IdleSource,
  private val factory: IdleConnection.Factory,
  private val changed: () -> Unit,
  private val backoff: IdleBackoff,
  private val clock: () -> Long,
  private val log: IdleLog,
  private val renewMillis: Long
) : Runnable {
  enum class State {
    CONNECTING,
    IDLE,
    BACKOFF,
    AUTH_FAILED,
    UNSUPPORTED,
    STOPPED
  }

  @Volatile var state = State.CONNECTING
    private set

  @Volatile var lastError = ""
    private set

  @Volatile private var session: IdleSession? = null

  @Volatile private var stopped = false
  private val pause = ReentrantLock()
  private val wakeUp = pause.newCondition()

  /** Set by a network that came back, so that a wait for the next try is cut short. */
  private var retryNow = false
  private var failures = 0

  /** Ends the watching: the connection is closed and the thread leaves. */
  fun stop() {
    stopped = true
    session?.stop()
    pause.withLock { wakeUp.signalAll() }
  }

  /**
   * The network is back: a wait after a connection that failed ends now, and the pauses begin from the first again. A wait
   * after a refused login does not: a network that comes and goes would repeat a wrong password every time.
   */
  fun networkAvailable() {
    pause.withLock {
      if (state != State.BACKOFF) return
      failures = 0
      retryNow = true
      wakeUp.signalAll()
    }
  }

  override fun run() {
    while (!stopped) {
      state = State.CONNECTING
      val begun = clock()
      val pauseMillis: Long
      try {
        watch()
        return
      } catch (error: IdleAuthFailedException) {
        state = State.AUTH_FAILED
        lastError = error.message.orEmpty()
        log.warn("$source: the login was refused, trying again later")
        pauseMillis = backoff.afterAuthFailure
      } catch (error: IdleUnsupportedException) {
        state = State.UNSUPPORTED
        lastError = error.message.orEmpty()
        log.warn("$source: the server cannot IDLE, trying again later")
        pauseMillis = backoff.afterUnsupported
      } catch (error: IOException) {
        if (stopped) break
        state = State.BACKOFF
        lastError = error.message.toString()
        if (clock() - begun >= backoff.counted) failures = 0
        pauseMillis = backoff.after(failures)
        failures += 1
        log.info("$source: connection ended ($lastError), again in ${pauseMillis / 1000} s")
      }
      waitFor(pauseMillis)
    }
    state = State.STOPPED
  }

  private fun watch() {
    val idle =
      IdleSession(
        factory,
        IdleSession.Config(source.host, source.port, source.security, source.username, source.password, source.mailbox, renewMillis),
        object : IdleSession.Listener {
          override fun onConnected() {
            state = State.IDLE
            lastError = ""
            // What came while there was no connection is found by one look, so every new connection asks for one.
            changed()
          }

          override fun onChange() = changed()
        },
        clock
      )
    session = idle
    if (stopped) idle.stop()
    idle.run()
  }

  /** Waits for the pause to pass, or for the network to come back, or for the end. */
  private fun waitFor(millis: Long) {
    val end = clock() + millis
    pause.withLock {
      while (!stopped && !retryNow) {
        val left = end - clock()
        if (left <= 0) break
        try {
          wakeUp.await(left, TimeUnit.MILLISECONDS)
        } catch (interrupted: InterruptedException) {
          Thread.currentThread().interrupt()
          stopped = true
        }
      }
      retryNow = false
    }
  }
}

/** The watchers of all sources: one thread each, started, replaced and ended as the sources change. */
class IdleWatchers(
  private val factory: IdleConnection.Factory,
  private val changed: () -> Unit,
  private val backoff: IdleBackoff,
  private val clock: () -> Long,
  private val log: IdleLog,
  private val renewMillis: Long
) {
  private val running = HashMap<String, IdleWatcher>()

  /** Makes what is watched what the sources say: a new one is started, a changed one replaced, one that is gone ended. */
  @Synchronized
  fun apply(sources: Collection<IdleSource>) {
    val wanted = HashSet<String>()
    for (source in sources) {
      wanted.add(source.sourceId)
      val current = running[source.sourceId]
      if (current != null && current.source == source) continue
      current?.stop()
      start(source)
    }
    for (id in running.keys.toList()) if (id !in wanted) running.remove(id)?.stop()
  }

  @Synchronized
  fun networkAvailable() = running.values.forEach { it.networkAvailable() }

  @Synchronized
  fun stopAll() {
    running.values.forEach { it.stop() }
    running.clear()
  }

  @Synchronized
  fun count() = running.size

  /** What is watched and in what state, for the log and the tests. No passwords. */
  @Synchronized
  fun states(): Map<String, IdleWatcher.State> = running.mapValues { it.value.state }

  private fun start(source: IdleSource) {
    val watcher = IdleWatcher(source, factory, changed, backoff, clock, log, renewMillis)
    running[source.sourceId] = watcher
    Thread(watcher, "watch ${source.sourceId}").apply { isDaemon = true }.start()
  }
}

/**
 * Lets a wake through, and not more often than a gap allows.
 *
 * Mail arrives in bursts, and each message is a change. One look for mail finds all of them, so the second change within the
 * gap does not start another look at once. It is not dropped either: one is left for the end of the gap, since the look that
 * was started by the first change may have been over before the second message came.
 */
class WakeGate(
  private val gapMillis: Long,
  private val clock: () -> Long,
  private val later: (task: Runnable, delayMillis: Long) -> Unit,
  private val wake: () -> Unit
) {
  private var last: Long? = null
  private var waiting = false

  fun request() {
    var delay = -1L
    var now = false
    synchronized(this) {
      val since = last?.let { clock() - it } ?: Long.MAX_VALUE
      if (since >= gapMillis) {
        last = clock()
        now = true
      } else if (!waiting) {
        waiting = true
        delay = gapMillis - since
      }
    }
    // Nothing is started with the lock held.
    if (now) {
      wake()
    } else if (delay >= 0) {
      later(
        Runnable {
          synchronized(this) {
            waiting = false
            last = clock()
          }
          wake()
        },
        delay
      )
    }
  }
}
