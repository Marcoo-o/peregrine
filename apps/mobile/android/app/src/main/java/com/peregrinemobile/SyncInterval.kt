package com.peregrinemobile

/** How often the platform lets periodic work run, which is a rule of its own and not the scheduler's. */
object SyncInterval {
  /** The least the platform allows for periodic work. Less is raised to this by the platform itself, silently. */
  const val MINIMUM_MINUTES = 15L

  /** The interval that is asked the scheduler for: what the user chose, and never less than the platform allows. */
  fun usable(minutes: Long): Long = maxOf(minutes, MINIMUM_MINUTES)
}
