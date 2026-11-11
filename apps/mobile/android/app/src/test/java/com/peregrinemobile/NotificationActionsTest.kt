package com.peregrinemobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationActionsTest {
  @Test
  fun knowsTheTwoActionsOfTheTask() {
    assertTrue(NotificationActions.isKnown(NotificationActions.ARCHIVE))
    assertTrue(NotificationActions.isKnown(NotificationActions.READ))
    assertFalse(NotificationActions.isKnown("delete"))
    assertFalse(NotificationActions.isKnown(null))
  }

  @Test
  fun handsTheTaskTheActionAndTheMessage() {
    val data = NotificationActions.dataOf(NotificationActions.ARCHIVE, LaunchTarget.Target("acc", "folder", 42))
    assertEquals("archive", data.getString("action"))
    assertEquals("acc", data.getString("accountId"))
    assertEquals("folder", data.getString("folderId"))
    assertEquals(42, data.getInt("uid", -1))
  }
}
