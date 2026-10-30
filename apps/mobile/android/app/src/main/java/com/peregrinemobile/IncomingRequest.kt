package com.peregrinemobile

/**
 * What another application asked of this one, kept until JavaScript has asked for it.
 *
 * A link to an address (`mailto:`) and something shared with this application arrive as an intent, which starts the activity or
 * brings it forward when it is running. As with a tap on a notification, JavaScript is not told by the intent: it asks when it starts
 * and whenever the application comes to the front, and gets the request once. What is made of it is decided there.
 *
 * The files that are shared are not copied here: only their addresses are kept. The permission to read them that the sender gave
 * lasts as long as the activity does, which is why JavaScript asks as soon as it can.
 */
object IncomingRequest {
  /** What an intent carried, in the shape that is held until it is asked for. */
  data class Request(
    val mailto: String?,
    val subject: String,
    val text: String,
    val to: List<String>,
    val cc: List<String>,
    val bcc: List<String>,
    val streams: List<String>,
    /** How many files were named that are not read, because their address is not one that may be. */
    val refused: Int = 0
  )

  @Volatile private var pending: Request? = null

  /** Keeps a request. One that is kept already is replaced: it is the newest that somebody is waiting for. */
  fun remember(request: Request?) {
    if (request != null) pending = request
  }

  /** The request that was kept, which is then gone. */
  fun consume(): Request? {
    val request = pending
    pending = null
    return request
  }

  /** The link an intent opened, when it is one to write to an address: a view or a send-to of the scheme `mailto`. */
  fun mailtoOf(action: String?, data: String?): String? {
    if (action != "android.intent.action.VIEW" && action != "android.intent.action.SENDTO") return null
    return data?.takeIf { it.startsWith("mailto:", ignoreCase = true) }
  }

  /**
   * Whether a shared file may be read from the address it came with: a content address of another application, which that application
   * allowed this one to read. A path (`file:`) is not, since it would be read with the permissions of this application, which is
   * the one that can read its own database. Nor is a content address of this application's own provider.
   */
  fun readableStream(address: String, ownAuthority: String): Boolean {
    if (!address.startsWith("content://", ignoreCase = true)) return false
    val authority = address.substring("content://".length).substringBefore('/').substringBefore('?').substringAfterLast('@')
    return !authority.equals(ownAuthority, ignoreCase = true)
  }
}
