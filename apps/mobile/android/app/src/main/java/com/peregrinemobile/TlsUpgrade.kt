package com.peregrinemobile

import java.net.Socket
import javax.net.ssl.SNIHostName
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

/**
 * Turns an open connection into a TLS one, and checks that the certificate belongs to the host that
 * was asked for.
 *
 * That second part is the reason this exists. A Java `SSLSocket` verifies the certificate chain and
 * says nothing about whose certificate it is unless it is told to, so a handshake that succeeds
 * proves only that somebody holds some certificate a trusted authority signed. Without the host name
 * check anybody on the path can present their own and read the mail. The library this replaced did
 * not make the check, and for a STARTTLS upgrade it handed over the address of the socket where the
 * name belongs.
 *
 * The same function serves a connection that starts encrypted and one that is upgraded, so there is
 * one path to get right and one to test.
 */
object TlsUpgrade {
  /** How long the handshake may take. A server that accepts the connection and then says nothing. */
  const val HANDSHAKE_TIMEOUT_MS = 30_000

  /**
   * @param plain an open connection, which is wrapped and from then on belongs to the result
   * @param host the name the user asked for, which the certificate has to be valid for. Never
   *   what the server says about itself.
   * @throws javax.net.ssl.SSLException when the handshake fails or the certificate is not valid for
   *   [host]. The connection is closed first, so nothing is left half open.
   */
  fun secure(
    plain: Socket,
    host: String,
    factory: SSLSocketFactory = SSLSocketFactory.getDefault() as SSLSocketFactory,
  ): SSLSocket {
    val secured =
      try {
        // The host goes in as the name of the peer. The wrapped socket is told it is talking to
        // `host`, which is what both the server name indication and the check below use.
        factory.createSocket(plain, host, plain.port, true) as SSLSocket
      } catch (e: Exception) {
        plain.close()
        throw e
      }
    try {
      val parameters = secured.sslParameters
      // Without this, no host name is checked. "HTTPS" is the name of the matching rules, which are
      // the ones that apply to any TLS client: subject alternative names first, a wildcard covers
      // one label, and an IP address has to appear as an IP address.
      parameters.endpointIdentificationAlgorithm = "HTTPS"
      // A host name, but not an address: an address is no valid server name indication.
      if (!isIpLiteral(host)) parameters.serverNames = listOf(SNIHostName(host))
      secured.sslParameters = parameters
      secured.useClientMode = true
      secured.soTimeout = HANDSHAKE_TIMEOUT_MS
      secured.startHandshake()
      secured.soTimeout = 0
      return secured
    } catch (e: Exception) {
      secured.close()
      throw e
    }
  }

  /** True for `192.0.2.7` and `2001:db8::1`, which are never looked up and never named in SNI. */
  fun isIpLiteral(host: String): Boolean {
    if (host.contains(':')) return true
    val parts = host.split('.')
    if (parts.size != 4) return false
    return parts.all { part -> part.isNotEmpty() && part.length <= 3 && part.all { it.isDigit() } }
  }
}
