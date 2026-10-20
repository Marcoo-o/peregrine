package com.peregrinemobile

import org.junit.Assert.assertEquals
import org.junit.Test

class SyncIntervalTest {
  @Test
  fun what_the_platform_allows_is_used_as_it_is() {
    assertEquals(15L, SyncInterval.usable(15))
    assertEquals(30L, SyncInterval.usable(30))
    assertEquals(240L, SyncInterval.usable(240))
  }

  @Test
  fun less_than_the_platform_allows_is_raised_to_what_it_allows() {
    assertEquals(15L, SyncInterval.usable(1))
    assertEquals(15L, SyncInterval.usable(0))
    assertEquals(15L, SyncInterval.usable(-5))
  }
}
