package com.peregrinemobile

import java.io.BufferedInputStream
import java.io.IOException
import java.io.InputStream
import java.net.SocketTimeoutException
import java.util.Locale

/** The login was refused. Trying again at once would only repeat it, and a wrong password may lock the account. */
class IdleAuthFailedException(message: String) : IOException(message)

/** The server cannot IDLE. */
class IdleUnsupportedException(message: String) : IOException(message)

/**
 * One session with an IMAP server that says when something changed in a mailbox.
 *
 * It logs in, opens the mailbox for reading only (EXAMINE: watching must not change anything on the server) and waits in
 * IDLE. Every `EXISTS`, `EXPUNGE` and `FETCH` the server reports is a change. IDLE is begun again before any router in
 * between would close a connection that looks idle (the server's own limit is thirty minutes, and a mobile network forgets
 * a quiet connection much sooner).
 *
 * Runs on the thread that calls [run] and returns only by throwing: when the connection ends, the login is refused, or the
 * server cannot IDLE, or when [stop] closes the connection from another thread.
 */
class IdleSession(
  private val factory: IdleConnection.Factory,
  private val config: Config,
  private val listener: Listener,
  private val clock: () -> Long = System::currentTimeMillis
) {
  interface Listener {
    /** The session is ready and waiting: logged in, the mailbox open, IDLE begun. */
    fun onConnected()

    /** Something in the mailbox changed. */
    fun onChange()
  }

  /** What a session needs to know of where it goes. */
  data class Config(
    val host: String,
    val port: Int,
    val security: String,
    val username: String,
    val password: String,
    val mailbox: String,
    /** How long one IDLE lasts before it is begun again. */
    val renewMillis: Long = DEFAULT_RENEW_MILLIS
  )

  @Volatile private var connection: IdleConnection? = null

  /** The input of the connection, buffered: a line is read a byte at a time, which a socket must not be asked for one by one. */
  private var input: InputStream? = null

  @Volatile private var stopped = false
  private var tags = 0
  private val partial = StringBuilder()
  private var capabilities: List<String> = emptyList()

  /** Ends the session from another thread: the connection is closed, and the read that waits for it fails. */
  fun stop() {
    stopped = true
    connection?.close()
  }

  @Throws(IOException::class)
  fun run() {
    val opened = factory.open(config.host, config.port, config.security == SECURITY_TLS)
    use(opened)
    if (stopped) {
      opened.close()
      throw IOException("stopped")
    }
    try {
      session()
    } finally {
      connection?.close()
    }
  }

  private fun use(next: IdleConnection) {
    connection = next
    input = BufferedInputStream(next.input, 4096)
  }

  private fun session() {
    connection!!.setReadTimeout(COMMAND_TIMEOUT_MS)
    val greeting = readLine()
    if (!greeting.startsWith("* OK", ignoreCase = true) && !greeting.startsWith("* PREAUTH", ignoreCase = true)) {
      throw IOException("the server did not greet: ${abbreviated(greeting)}")
    }
    readCapabilities()
    if (config.security == SECURITY_STARTTLS) startTls()

    login()
    if ("IDLE" !in capabilities) readCapabilities()
    if ("IDLE" !in capabilities) throw IdleUnsupportedException("the server cannot IDLE")

    val tag = send("EXAMINE", quoted(config.mailbox))
    val result = readUntilTagged(tag)
    if (!isOk(result, tag)) throw IOException("the mailbox cannot be opened: ${abbreviated(result)}")

    listener.onConnected()
    while (true) idleOnce()
  }

  private fun startTls() {
    if ("STARTTLS" !in capabilities) throw IOException("the server does not offer STARTTLS")
    val tag = send("STARTTLS")
    val result = readUntilTagged(tag)
    if (!isOk(result, tag)) throw IOException("STARTTLS was refused: ${abbreviated(result)}")
    val upgraded = connection!!.upgradeToTls(config.host)
    use(upgraded)
    if (stopped) {
      upgraded.close()
      throw IOException("stopped")
    }
    partial.setLength(0)
    // What the server said before the encryption is not to be trusted any more.
    capabilities = emptyList()
    readCapabilities()
  }

  private fun login() {
    val tag = send("LOGIN", quoted(config.username), quoted(config.password))
    val result = readUntilTagged(tag)
    if (isOk(result, tag)) {
      CAPABILITY.find(result)?.let { capabilities = split(it.groupValues[1]) }
      return
    }
    val refused = result.regionMatches(tag.length + 1, "NO", 0, 2, ignoreCase = true)
    // The server saying that it is busy or broken is not the server saying that the login is wrong.
    val upper = result.uppercase(Locale.ROOT)
    val temporary = "[UNAVAILABLE]" in upper || "[INUSE]" in upper || "[SERVERBUG]" in upper
    if (refused && !temporary) throw IdleAuthFailedException(abbreviated(result))
    throw IOException("the login failed: ${abbreviated(result)}")
  }

  private fun readCapabilities() {
    val tag = send("CAPABILITY")
    val result = readUntilTagged(tag)
    if (!isOk(result, tag)) throw IOException("CAPABILITY failed: ${abbreviated(result)}")
  }

  /** One stretch of IDLE: begun, listened to until it is time to renew it, ended. */
  private fun idleOnce() {
    val tag = send("IDLE")
    // The server answers with a line that begins with "+" when it is idling.
    while (true) {
      val line = readLine()
      if (line.startsWith("+")) break
      if (isTagged(line, tag)) throw IOException("IDLE was refused: ${abbreviated(line)}")
      noteChange(line)
    }
    val begun = clock()
    var ended = false
    while (!ended) {
      val left = config.renewMillis - (clock() - begun)
      if (left <= 0) break
      connection!!.setReadTimeout(minOf(left, Int.MAX_VALUE.toLong()).toInt())
      val line =
        try {
          readLine()
        } catch (timeout: SocketTimeoutException) {
          // Nothing came: time to renew. What was read of a line stays in the buffer.
          continue
        }
      if (isTagged(line, tag)) {
        // The server ended IDLE by itself.
        ended = true
      } else {
        noteChange(line)
      }
    }
    connection!!.setReadTimeout(COMMAND_TIMEOUT_MS)
    if (!ended) {
      write("DONE\r\n")
      // What arrives between DONE and its answer is a change like any other.
      val result = readUntilTagged(tag, tellChanges = true)
      if (!isOk(result, tag)) throw IOException("IDLE did not end well: ${abbreviated(result)}")
    }
  }

  private fun noteChange(line: String) {
    if (line.startsWith("* BYE", ignoreCase = true)) throw IOException("the server closed the connection: ${abbreviated(line)}")
    if (CHANGE.containsMatchIn(line)) listener.onChange()
  }

  /** Sends a command with a new tag, and returns the tag. A part that has to be a literal is sent as one. */
  private fun send(command: String, vararg arguments: Any): String {
    val tag = "p${++tags}"
    val line = StringBuilder(tag).append(' ').append(command)
    for (argument in arguments) {
      line.append(' ')
      if (argument is ByteArray) {
        line.append('{').append(argument.size).append("}\r\n")
        write(line.toString())
        // The server asks for the literal with a "+" line before it takes it.
        val go = readLine()
        if (!go.startsWith("+")) throw IOException("the server did not take the literal: ${abbreviated(go)}")
        connection!!.output.write(argument)
        connection!!.output.flush()
        line.setLength(0)
      } else {
        line.append(argument)
      }
    }
    write(line.append("\r\n").toString())
    return tag
  }

  private fun write(text: String) {
    val out = connection!!.output
    out.write(text.toByteArray(Charsets.UTF_8))
    out.flush()
  }

  /** Reads up to and including the tagged answer of a command, and returns that line. */
  private fun readUntilTagged(tag: String, tellChanges: Boolean = false): String {
    while (true) {
      val line = readLine()
      if (isTagged(line, tag)) return line
      if (line.startsWith("* CAPABILITY ", ignoreCase = true)) capabilities = split(line.substring("* CAPABILITY ".length))
      if (line.startsWith("* BYE", ignoreCase = true)) throw IOException("the server closed the connection: ${abbreviated(line)}")
      if (tellChanges && CHANGE.containsMatchIn(line)) listener.onChange()
    }
  }

  /**
   * Reads one answer line, with the literals in it left out, since nothing is needed of them. A timeout while a line is only
   * half read leaves that half in the buffer, and the next call goes on with it.
   */
  private fun readLine(): String {
    val stream = input!!
    while (true) {
      val next = stream.read()
      if (next < 0) throw IOException("the server closed the connection")
      if (next == '\n'.code) {
        val length = partial.length
        if (length > 0 && partial[length - 1] == '\r') partial.setLength(length - 1)
        val line = partial.toString()
        val literal = LITERAL.find(line)
        if (literal != null) {
          skip(stream, literal.groupValues[1].toInt())
          // The line goes on after the literal.
          continue
        }
        partial.setLength(0)
        return line
      }
      partial.append((next and 0xFF).toChar())
      if (partial.length > MAX_LINE) throw IOException("a line from the server is too long")
    }
  }

  private fun skip(stream: InputStream, count: Int) {
    if (count > MAX_LITERAL) throw IOException("a literal from the server is too long")
    repeat(count) { if (stream.read() < 0) throw IOException("the server closed the connection") }
    partial.append(' ')
  }

  private fun quoted(text: String): Any {
    if (text.any { it.code < 0x20 || it.code > 0x7E }) return text.toByteArray(Charsets.UTF_8)
    return "\"" + text.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
  }

  private fun isTagged(line: String, tag: String) = line.startsWith("$tag ")

  private fun isOk(taggedLine: String, tag: String) = taggedLine.regionMatches(tag.length + 1, "OK", 0, 2, ignoreCase = true)

  private fun split(capabilityText: String): List<String> =
    capabilityText.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }.map { it.uppercase(Locale.ROOT) }

  /** A line of the server for a message: short, and with nothing of what could be a secret. */
  private fun abbreviated(line: String) = if (line.length > 120) line.substring(0, 120) + "..." else line

  companion object {
    const val SECURITY_TLS = "tls"
    const val SECURITY_STARTTLS = "starttls"

    /**
     * Ten minutes: a mobile network forgets a connection that is quiet for longer than that, and the phone would then wait
     * for a push that cannot come until the next renewal finds the connection dead.
     */
    const val DEFAULT_RENEW_MILLIS = 10 * 60 * 1000L

    private val CHANGE = Regex("^\\* \\d+ (EXISTS|EXPUNGE|FETCH)\\b", RegexOption.IGNORE_CASE)
    private val LITERAL = Regex("\\{(\\d+)\\}$")
    private val CAPABILITY = Regex("CAPABILITY ([^\\]]*)", RegexOption.IGNORE_CASE)
    private const val MAX_LINE = 64 * 1024
    private const val MAX_LITERAL = 1024 * 1024

    /** How long the server may take to answer a command before the session is given up on. */
    private const val COMMAND_TIMEOUT_MS = 60_000
  }
}
