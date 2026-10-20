package com.peregrinemobile

/**
 * The message a notification was tapped for, kept until the application has asked for it.
 *
 * A tap on a notification starts the activity, or brings it forward when it is running, with the
 * message in the extras of the intent. JavaScript is not told by the intent. It asks when it starts and
 * whenever the application comes to the front, and gets the target once: a target that stayed would
 * open the same message again at the next start.
 */
object LaunchTarget {
  const val EXTRA_ACCOUNT = "peregrine.accountId"
  const val EXTRA_FOLDER = "peregrine.folderId"
  const val EXTRA_UID = "peregrine.uid"

  data class Target(val accountId: String, val folderId: String, val uid: Int)

  @Volatile private var pending: Target? = null

  /** The target an intent carries, or null when it carries none or not all of one. */
  fun fromExtras(accountId: String?, folderId: String?, uid: Int): Target? {
    if (accountId.isNullOrEmpty() || folderId.isNullOrEmpty() || uid < 0) return null
    return Target(accountId, folderId, uid)
  }

  /** Keeps the target of an intent. An intent with none leaves what was kept as it is. */
  fun remember(target: Target?) {
    if (target != null) pending = target
  }

  /** The target that was kept, which is then gone. */
  fun consume(): Target? {
    val target = pending
    pending = null
    return target
  }
}
