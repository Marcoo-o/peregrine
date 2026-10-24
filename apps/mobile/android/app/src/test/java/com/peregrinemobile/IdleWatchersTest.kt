package com.peregrinemobile

import java.util.concurrent.atomic.AtomicInteger
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class IdleWatchersTest {
  private lateinit var server: FakeImapServer
  private val changes = AtomicInteger()
  private lateinit var watchers: IdleWatchers

  /** Short pauses so that the tests do not wait; the pauses after a refused login and for a server that cannot IDLE stay long. */
  private fun quick() = IdleBackoff(longArrayOf(50, 100), 60_000, 60_000, 10_000)

  private fun watchersFor(backoff: IdleBackoff) =
    IdleWatchers(PLAIN_CONNECTIONS, { changes.incrementAndGet() }, backoff, System::currentTimeMillis, IdleLog.None, IdleSession.DEFAULT_RENEW_MILLIS)

  @Before
  fun start() {
    server = FakeImapServer()
    watchers = watchersFor(quick())
  }

  @After
  fun end() {
    watchers.stopAll()
    server.close()
  }

  private fun source(id: String, password: String) = IdleSource(id, "127.0.0.1", server.port, "none", "alex", password, "INBOX")

  private fun until(what: String, condition: () -> Boolean) {
    val deadline = System.currentTimeMillis() + 5000
    while (!condition() && System.currentTimeMillis() < deadline) Thread.sleep(10)
    assertTrue(what, condition())
  }

  private fun state(id: String) = watchers.states()[id]

  @Test
  fun tellsOfTheConnectionAndOfEveryChange() {
    watchers.apply(listOf(source("a", "secret")))
    until("told when connected") { changes.get() == 1 }
    until("idling") { state("a") == IdleWatcher.State.IDLE }
    server.say("* 3 EXISTS")
    until("told of the change") { changes.get() == 2 }
  }

  @Test
  fun connectsAgainAfterTheConnectionEnded() {
    watchers.apply(listOf(source("a", "secret")))
    until("idling") { state("a") == IdleWatcher.State.IDLE }
    server.hangUp()
    until("connected again") { server.connections.get() == 2 && changes.get() == 2 }
  }

  @Test
  fun doesNotTryAgainAtOnceAfterARefusedLogin() {
    watchers.apply(listOf(source("a", "wrong")))
    until("refused") { state("a") == IdleWatcher.State.AUTH_FAILED }
    watchers.networkAvailable()
    Thread.sleep(300)
    assertEquals("a network that comes back does not repeat a wrong password", 1, server.connections.get())
    assertEquals(0, changes.get())
  }

  @Test
  fun tryingAgainIsCutShortWhenTheNetworkComesBack() {
    watchers.stopAll()
    watchers = watchersFor(IdleBackoff(longArrayOf(60_000), 60_000, 60_000, 10_000))
    watchers.apply(listOf(source("a", "secret")))
    until("idling") { state("a") == IdleWatcher.State.IDLE }
    server.hangUp()
    until("waiting") { state("a") == IdleWatcher.State.BACKOFF }
    watchers.networkAvailable()
    until("connected again at once") { server.connections.get() == 2 }
  }

  @Test
  fun replacesTheWatcherOfASourceThatChanged() {
    watchers.apply(listOf(source("a", "secret")))
    until("idling") { state("a") == IdleWatcher.State.IDLE }
    server.password = "changed"
    watchers.apply(listOf(source("a", "changed")))
    until("connected with the new login") { server.connections.get() == 2 && changes.get() == 2 }
    assertEquals(1, watchers.count())
  }

  @Test
  fun endsTheWatcherOfASourceThatIsGone() {
    watchers.apply(listOf(source("a", "secret")))
    until("idling") { state("a") == IdleWatcher.State.IDLE }
    watchers.apply(emptyList())
    assertEquals(0, watchers.count())
    until("the connection was ended") {
      try {
        server.say("* 7 EXISTS")
        false
      } catch (ended: Exception) {
        true
      }
    }
  }

  @Test
  fun leavesAWatcherAloneWhenItsSourceIsTheSameAgain() {
    watchers.apply(listOf(source("a", "secret")))
    until("idling") { state("a") == IdleWatcher.State.IDLE }
    watchers.apply(listOf(source("a", "secret")))
    Thread.sleep(200)
    assertEquals(1, server.connections.get())
  }

  @Test
  fun neverShowsThePasswordWhereItIsWrittenDown() {
    assertFalse(source("a", "hunter2").toString().contains("hunter2"))
  }

  @Test
  fun takesTheLastPauseFromThenOn() {
    val backoff = IdleBackoff.standard()
    val pauses = (0..7).map { backoff.after(it) }
    assertEquals(5_000L, pauses[0])
    assertEquals(300_000L, pauses[4])
    assertEquals(300_000L, pauses[7])
    assertEquals(5_000L, backoff.after(-3))
  }
}

class WakeGateTest {
  private var now = 100_000L
  private var woken = 0
  private val later = ArrayList<Runnable>()
  private val delays = ArrayList<Long>()
  private val gate = WakeGate(10_000, { now }, { task, delay -> later.add(task).also { delays.add(delay) } }, { woken += 1 })

  private fun runLater() {
    val due = ArrayList(later)
    later.clear()
    due.forEach { it.run() }
  }

  @Test
  fun letsTheFirstThroughAtOnce() {
    gate.request()
    assertEquals(1, woken)
  }

  @Test
  fun letsNoSecondThroughWithinTheGapButKeepsOneForTheEndOfIt() {
    gate.request()
    now += 3_000
    gate.request()
    gate.request()
    assertEquals("only the first at once", 1, woken)
    assertEquals("one is left for the end of the gap, and not one for each", 1, later.size)
    assertEquals(7_000L, delays[0])
    now += 7_000
    runLater()
    assertEquals(2, woken)
  }

  @Test
  fun letsOneThroughAtOnceAgainOnceTheGapIsOver() {
    gate.request()
    now += 10_000
    gate.request()
    assertEquals(2, woken)
    assertEquals(0, later.size)
  }
}
