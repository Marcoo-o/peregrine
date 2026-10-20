package com.peregrinemobile

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LaunchTargetTest {
  @After
  fun forget() {
    LaunchTarget.consume()
  }

  @Test
  fun a_target_needs_an_account_a_folder_and_a_uid() {
    assertEquals(LaunchTarget.Target("a", "f", 7), LaunchTarget.fromExtras("a", "f", 7))
    assertNull(LaunchTarget.fromExtras(null, "f", 7))
    assertNull(LaunchTarget.fromExtras("a", null, 7))
    assertNull(LaunchTarget.fromExtras("", "f", 7))
    assertNull(LaunchTarget.fromExtras("a", "", 7))
  }

  @Test
  fun a_uid_that_is_missing_is_no_target() {
    // getIntExtra answers -1 when the intent has none
    assertNull(LaunchTarget.fromExtras("a", "f", -1))
  }

  @Test
  fun a_target_is_given_once() {
    LaunchTarget.remember(LaunchTarget.Target("a", "f", 7))
    assertEquals(LaunchTarget.Target("a", "f", 7), LaunchTarget.consume())
    assertNull(LaunchTarget.consume())
  }

  @Test
  fun the_newest_target_is_the_one_kept() {
    LaunchTarget.remember(LaunchTarget.Target("a", "f", 1))
    LaunchTarget.remember(LaunchTarget.Target("a", "f", 2))
    assertEquals(2, LaunchTarget.consume()?.uid)
  }

  @Test
  fun an_intent_with_no_target_leaves_the_one_that_was_kept() {
    LaunchTarget.remember(LaunchTarget.Target("a", "f", 3))
    LaunchTarget.remember(null)
    assertEquals(3, LaunchTarget.consume()?.uid)
  }
}
