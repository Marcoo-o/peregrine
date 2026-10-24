package com.peregrinemobile

import java.io.Closeable
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import javax.net.ssl.SSLParameters
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

/**
 * A connection to a mail server, as far as the IDLE session needs to know of it. The service gives it sockets, the tests
 * give it sockets to a server they run themselves.
 */
interface IdleConnection : Closeable {
  val input: InputStream

  val output: OutputStream

  /** How long a read waits before it fails with a SocketTimeoutException; 0 waits for ever. */
  fun setReadTimeout(milliseconds: Int)

  /** The same connection made encrypted, after the server agreed to STARTTLS. */
  fun upgradeToTls(host: String): IdleConnection

  override fun close()

  /** Makes the connections: encrypted from the first byte, or not at all. */
  fun interface Factory {
    fun open(host: String, port: Int, tls: Boolean): IdleConnection
  }
}

/** A connection on a socket. The certificate of an encrypted one is checked against the host name it was asked for. */
class SocketIdleConnection private constructor(private val socket: Socket) : IdleConnection {
  override val input: InputStream
    get() = socket.getInputStream()

  override val output: OutputStream
    get() = socket.getOutputStream()

  override fun setReadTimeout(milliseconds: Int) {
    socket.soTimeout = milliseconds
  }

  override fun upgradeToTls(host: String): IdleConnection = SocketIdleConnection(encrypt(socket, host, socket.port))

  override fun close() {
    try {
      socket.close()
    } catch (ignored: IOException) {
      // A connection that cannot be closed is as closed as it gets.
    }
  }

  companion object {
    private const val CONNECT_TIMEOUT_MS = 20_000

    val FACTORY = IdleConnection.Factory { host, port, tls ->
      val plain = Socket()
      try {
        plain.connect(InetSocketAddress(host, port), CONNECT_TIMEOUT_MS)
        plain.keepAlive = true
        SocketIdleConnection(if (tls) encrypt(plain, host, port) else plain)
      } catch (error: IOException) {
        plain.close()
        throw error
      } catch (error: RuntimeException) {
        plain.close()
        throw error
      }
    }

    private fun encrypt(plain: Socket, host: String, port: Int): SSLSocket {
      val secured = (SSLSocketFactory.getDefault() as SSLSocketFactory).createSocket(plain, host, port, true) as SSLSocket
      val parameters: SSLParameters = secured.sslParameters
      // Without this the certificate would be checked to be valid, and not to be the one of this server.
      parameters.endpointIdentificationAlgorithm = "HTTPS"
      secured.sslParameters = parameters
      secured.startHandshake()
      return secured
    }
  }
}
