package com.peregrinemobile

import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class IdleSessionTest {
  private lateinit var server: FakeImapServer

  @Before
  fun start() {
    server = FakeImapServer()
  }

  @After
  fun end() {
    server.close()
  }

  /** A session on its own thread, with what happened to it counted. */
  private inner class Run(
    user: String = "alex",
    password: String = "secret",
    mailbox: String = "INBOX",
    renewMillis: Long = IdleSession.DEFAULT_RENEW_MILLIS
  ) {
    val changes = AtomicInteger()
    val connected = CountDownLatch(1)
    val ended = AtomicReference<Throwable>()
    val over = CountDownLatch(1)
    val idle =
      IdleSession(
        PLAIN_CONNECTIONS,
        IdleSession.Config("127.0.0.1", server.port, "none", user, password, mailbox, renewMillis),
        object : IdleSession.Listener {
          override fun onConnected() = connected.countDown()

          override fun onChange() {
            changes.incrementAndGet()
          }
        }
      )

    init {
      Thread {
          try {
            idle.run()
          } catch (error: Throwable) {
            ended.set(error)
          } finally {
            over.countDown()
          }
        }
        .apply { isDaemon = true }
        .start()
    }

    fun awaitConnected() = assertTrue("did not connect", connected.await(5, TimeUnit.SECONDS))

    fun awaitEnd(): Throwable? {
      assertTrue("did not end", over.await(5, TimeUnit.SECONDS))
      return ended.get()
    }

    fun awaitChanges(count: Int) {
      val deadline = System.currentTimeMillis() + 5000
      while (changes.get() < count && System.currentTimeMillis() < deadline) Thread.sleep(10)
      assertEquals(count, changes.get())
    }
  }

  @Test
  fun saysWhenItIsConnectedAndThenWhenSomethingChanges() {
    val run = Run()
    run.awaitConnected()
    assertEquals("opening the mailbox is no change", 0, run.changes.get())
    server.say("* 3 EXISTS")
    run.awaitChanges(1)
    server.say("* 1 EXPUNGE")
    server.say("* 2 FETCH (FLAGS (\\Seen))")
    run.awaitChanges(3)
    server.say("* OK still here")
    Thread.sleep(50)
    assertEquals(3, run.changes.get())
    run.idle.stop()
  }

  @Test
  fun watchesTheMailboxForReadingOnly() {
    val run = Run(mailbox = "Archive 2026")
    run.awaitConnected()
    assertTrue(server.received.contains("p3 EXAMINE \"Archive 2026\""))
    run.idle.stop()
  }

  @Test
  fun sendsAPasswordWithQuotesAndBackslashesAsItIs() {
    server.password = "pa\"ss\\word"
    val run = Run(password = "pa\"ss\\word")
    run.awaitConnected()
    run.idle.stop()
  }

  @Test
  fun sendsWhatIsNotPlainAsciiAsALiteral() {
    server.password = "pässwörd"
    val run = Run(password = "pässwörd")
    run.awaitConnected()
    run.idle.stop()
  }

  @Test
  fun saysThatTheLoginWasRefusedAndNotThatTheConnectionFailed() {
    val run = Run(password = "wrong")
    assertTrue(run.awaitEnd() is IdleAuthFailedException)
  }

  @Test
  fun takesAServerThatIsBusyForAConnectionThatFailed() {
    server.loginAnswer = "NO [UNAVAILABLE] try again later"
    val error = Run().awaitEnd()
    assertNotNull(error)
    assertFalse(error is IdleAuthFailedException)
  }

  @Test
  fun saysThatTheServerCannotIdle() {
    server.capabilities = "IMAP4rev1"
    assertTrue(Run().awaitEnd() is IdleUnsupportedException)
  }

  @Test
  fun beginsIdleAgainBeforeTheLimitAndStillSeesChanges() {
    val run = Run(renewMillis = 200)
    run.awaitConnected()
    val deadline = System.currentTimeMillis() + 5000
    while (server.count("DONE") < 2 && System.currentTimeMillis() < deadline) Thread.sleep(10)
    assertTrue("IDLE was not renewed", server.count("DONE") >= 2)
    server.say("* 9 EXISTS")
    run.awaitChanges(1)
    run.idle.stop()
  }

  @Test
  fun doesNotLoseAChangeThatArrivesWhileIdleEnds() {
    server.sayBeforeIdleEnds = "* 5 EXISTS"
    val run = Run(renewMillis = 150)
    run.awaitConnected()
    val deadline = System.currentTimeMillis() + 5000
    while (run.changes.get() < 1 && System.currentTimeMillis() < deadline) Thread.sleep(10)
    assertTrue(run.changes.get() >= 1)
    run.idle.stop()
  }

  @Test
  fun endsWhenTheServerEndsTheConnection() {
    val run = Run()
    run.awaitConnected()
    server.hangUp()
    assertTrue(run.awaitEnd() is IOException)
  }

  @Test
  fun endsWhenTheServerSaysBye() {
    val run = Run()
    run.awaitConnected()
    server.say("* BYE server shutting down")
    val error = run.awaitEnd()
    assertTrue(error is IOException)
    assertTrue(error!!.message!!.contains("BYE"))
  }

  @Test
  fun endsWhenItIsStoppedFromAnotherThread() {
    val run = Run()
    run.awaitConnected()
    run.idle.stop()
    assertNotNull(run.awaitEnd())
  }

  @Test
  fun refusesStartTlsWhereTheServerDoesNotOfferIt() {
    val ended = AtomicReference<Throwable>()
    val over = CountDownLatch(1)
    val idle =
      IdleSession(
        PLAIN_CONNECTIONS,
        IdleSession.Config("127.0.0.1", server.port, "starttls", "alex", "secret", "INBOX"),
        object : IdleSession.Listener {
          override fun onConnected() = Unit

          override fun onChange() = Unit
        }
      )
    Thread {
        try {
          idle.run()
        } catch (error: Throwable) {
          ended.set(error)
        } finally {
          over.countDown()
        }
      }
      .apply { isDaemon = true }
      .start()
    assertTrue(over.await(5, TimeUnit.SECONDS))
    assertTrue(ended.get() is IOException)
    assertTrue(ended.get().message!!.contains("STARTTLS"))
  }
}
