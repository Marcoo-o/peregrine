package com.peregrinemobile

import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.ServerSocket
import java.net.Socket
import java.util.Collections
import java.util.concurrent.atomic.AtomicInteger

/**
 * A small IMAP server for the tests: it greets, says what it can, takes a login, opens a mailbox, and idles until it is told
 * to say something. What it was sent is kept in [received] (a literal is put into the line it belongs to).
 */
class FakeImapServer : Closeable {
  private val server = ServerSocket(0)
  val received: MutableList<String> = Collections.synchronizedList(ArrayList())
  val connections = AtomicInteger()

  @Volatile var capabilities = "IMAP4rev1 IDLE"

  @Volatile var username = "alex"

  @Volatile var password = "secret"

  /** When set, the answer to LOGIN, after its tag. */
  @Volatile var loginAnswer: String? = null

  /** Said right before the tagged answer to DONE, which is a change that comes while IDLE ends. */
  @Volatile var sayBeforeIdleEnds: String? = null

  @Volatile private var out: OutputStream? = null

  @Volatile private var current: Socket? = null

  val port: Int
    get() = server.localPort

  init {
    Thread({ serve() }, "fake imap").apply { isDaemon = true }.start()
  }

  /** Says a line while the client is idling. */
  fun say(line: String) {
    val stream = out ?: throw IOException("nobody is connected")
    synchronized(stream) {
      stream.write("$line\r\n".toByteArray(Charsets.UTF_8))
      stream.flush()
    }
  }

  /** Ends the connection from the server's side. */
  fun hangUp() {
    current?.close()
  }

  fun count(command: String): Int = synchronized(received) { received.count { it == command } }

  override fun close() {
    server.close()
    hangUp()
  }

  private fun serve() {
    while (true) {
      val socket =
        try {
          server.accept()
        } catch (closed: IOException) {
          return
        }
      current = socket
      connections.incrementAndGet()
      try {
        talk(socket)
      } catch (ended: IOException) {
        // The client left or was hung up on.
      } finally {
        try {
          socket.close()
        } catch (ignored: IOException) {
          // Closed already.
        }
      }
    }
  }

  private fun talk(socket: Socket) {
    val input = socket.getInputStream()
    out = socket.getOutputStream()
    say("* OK ready")
    while (true) {
      val line = readCommand(input) ?: return
      received.add(line)
      val parts = line.split(" ", limit = 3)
      val tag = parts[0]
      when (parts.getOrElse(1) { "" }.uppercase()) {
        "CAPABILITY" -> {
          say("* CAPABILITY $capabilities")
          say("$tag OK done")
        }
        "LOGIN" -> login(tag, parts.getOrElse(2) { "" })
        "EXAMINE" -> {
          // The number of messages that is there, which is not a change.
          say("* 2 EXISTS")
          say("$tag OK [READ-ONLY] opened")
        }
        "IDLE" -> {
          say("+ idling")
          val done = readCommand(input) ?: return
          received.add(done)
          sayBeforeIdleEnds?.let { say(it) }
          say("$tag OK IDLE terminated")
        }
        else -> say("$tag BAD unknown command")
      }
    }
  }

  private fun login(tag: String, arguments: String) {
    val answer = loginAnswer
    if (answer != null) {
      say("$tag $answer")
      return
    }
    // A part is quoted when it is plain, and arrives as a literal, which is put into the line as it is, when it is not.
    val quotedUser = "\"$username\""
    val quotedPassword = "\"" + password.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
    val accepted =
      arguments == "$quotedUser $quotedPassword" ||
        arguments == "$quotedUser $password" ||
        arguments == "$username $quotedPassword" ||
        arguments == "$username $password"
    if (accepted) say("$tag OK [CAPABILITY $capabilities] logged in") else say("$tag NO [AUTHENTICATIONFAILED] wrong")
  }

  /** Reads one command line. A literal in it is asked for with "+", read, and put into the line. Null at the end. */
  private fun readCommand(input: InputStream): String? {
    val line = StringBuilder()
    while (true) {
      val part = readLine(input) ?: return null
      line.append(part)
      val open = part.lastIndexOf('{')
      if (open >= 0 && part.endsWith("}")) {
        val size = part.substring(open + 1, part.length - 1).toInt()
        line.setLength(line.length - (part.length - open))
        say("+ go")
        val literal = ByteArray(size)
        var read = 0
        while (read < size) {
          val count = input.read(literal, read, size - read)
          if (count < 0) return null
          read += count
        }
        line.append(String(literal, Charsets.UTF_8))
        continue
      }
      return line.toString()
    }
  }

  private fun readLine(input: InputStream): String? {
    val bytes = ByteArrayOutputStream()
    while (true) {
      val next = input.read()
      if (next < 0) return if (bytes.size() == 0) null else bytes.toString("UTF-8")
      if (next == '\n'.code) {
        val text = bytes.toString("UTF-8")
        return if (text.endsWith("\r")) text.dropLast(1) else text
      }
      bytes.write(next)
    }
  }
}

/** Plain connections to the fake server. */
val PLAIN_CONNECTIONS = IdleConnection.Factory { host, port, _ ->
  val socket = Socket(host, port)
  object : IdleConnection {
    override val input: InputStream
      get() = socket.getInputStream()

    override val output: OutputStream
      get() = socket.getOutputStream()

    override fun setReadTimeout(milliseconds: Int) {
      socket.soTimeout = milliseconds
    }

    override fun upgradeToTls(host: String): IdleConnection = throw UnsupportedOperationException()

    override fun close() {
      try {
        socket.close()
      } catch (ignored: IOException) {
        // Closed.
      }
    }
  }
}
