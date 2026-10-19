package com.peregrinemobile

import java.io.File
import java.net.ServerSocket
import java.net.Socket
import java.security.KeyStore
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLException
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManagerFactory
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

/**
 * The certificate check, against a server whose certificate is trusted by the test and made for
 * exactly one name: `mail.example.org`.
 *
 * Trusting it takes the chain out of the question. Whatever is refused here is refused because of
 * the name, which is the part a `SSLSocket` does not check unless it is asked to and the part the
 * library this replaced left out. It is also why every refusal has to be a refusal for that reason
 * and not for any other: the one test that shows the same socket accepting a wrong name without
 * the check is what makes the others mean something.
 */
class TlsUpgradeTest {
  private lateinit var server: ServerSocket
  private lateinit var trusting: SSLSocketFactory
  private lateinit var serving: SSLContext
  private lateinit var acceptor: Thread

  @Before
  fun setUp() {
    val keys = KeyStore.getInstance("PKCS12")
    File("src/test/resources/test-server.p12").inputStream().use { keys.load(it, PASSWORD) }

    val keyManagers =
      KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()).apply {
        init(keys, PASSWORD)
      }
    serving = SSLContext.getInstance("TLS").apply { init(keyManagers.keyManagers, null, null) }

    // The client trusts the certificate and nothing else, as if its authority had signed it.
    val anchors =
      KeyStore.getInstance(KeyStore.getDefaultType()).apply {
        load(null, null)
        setCertificateEntry("test", keys.getCertificate("server"))
      }
    val trustManagers =
      TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply {
        init(anchors)
      }
    trusting =
      SSLContext.getInstance("TLS")
        .apply { init(null, trustManagers.trustManagers, null) }
        .socketFactory

    server = ServerSocket(0)
    acceptor =
      Thread {
          while (!server.isClosed) {
            val connection =
              try {
                server.accept()
              } catch (_: Exception) {
                return@Thread
              }
            // One at a time is enough. A client that refuses the certificate ends its handshake
            // with an alert, which fails here and is of no interest.
            try {
              val tls =
                serving.socketFactory.createSocket(connection, null, connection.port, true)
                  as SSLSocket
              tls.useClientMode = false
              tls.startHandshake()
              tls.outputStream.write("hello\n".toByteArray())
              tls.outputStream.flush()
              tls.close()
            } catch (_: Exception) {
              connection.close()
            }
          }
        }
        .apply { isDaemon = true }
    acceptor.start()
  }

  @After
  fun tearDown() {
    server.close()
  }

  private fun connect(): Socket = Socket("127.0.0.1", server.localPort).apply { soTimeout = 5_000 }

  @Test
  fun `accepts the name the certificate was made for`() {
    val secured = TlsUpgrade.secure(connect(), "mail.example.org", trusting)
    assertEquals("hello", secured.inputStream.bufferedReader().readLine())
    secured.close()
  }

  @Test
  fun `refuses a certificate made for another name`() {
    val plain = connect()
    try {
      TlsUpgrade.secure(plain, "mail.example.net", trusting)
      fail("a certificate for mail.example.org was accepted for mail.example.net")
    } catch (e: SSLException) {
      // Expected: the name does not match.
    }
    assertTrue("the connection is left open after a refusal", plain.isClosed)
  }

  @Test
  fun `refuses a name below the one in the certificate`() {
    try {
      TlsUpgrade.secure(connect(), "evil.mail.example.org", trusting)
      fail("a certificate for mail.example.org was accepted for a name below it")
    } catch (e: SSLException) {
      // Expected: nothing in the certificate covers that name.
    }
  }

  @Test
  fun `refuses an address the certificate does not list`() {
    try {
      TlsUpgrade.secure(connect(), "127.0.0.1", trusting)
      fail("a certificate with only a name in it was accepted for an address")
    } catch (e: SSLException) {
      // Expected: an address must appear in the certificate as an address.
    }
  }

  // The reason the check exists. The same trusted certificate, the same wrong name, and a socket
  // that was not asked to check: the handshake succeeds. If this ever failed, the refusals above
  // would be refusals for some other reason and would prove nothing.
  @Test
  fun `a socket not told to check the name accepts the wrong one`() {
    val plain = connect()
    val socket = trusting.createSocket(plain, "mail.example.net", plain.port, true) as SSLSocket
    socket.useClientMode = true
    socket.startHandshake()
    assertEquals("hello", socket.inputStream.bufferedReader().readLine())
    socket.close()
  }

  @Test
  fun `recognises addresses and names`() {
    assertTrue(TlsUpgrade.isIpLiteral("192.0.2.7"))
    assertTrue(TlsUpgrade.isIpLiteral("2001:db8::1"))
    assertFalse(TlsUpgrade.isIpLiteral("mail.example.org"))
    assertFalse(TlsUpgrade.isIpLiteral("1.2.3.example.org"))
    assertFalse(TlsUpgrade.isIpLiteral("localhost"))
  }

  private companion object {
    val PASSWORD = "changeit".toCharArray()
  }
}
