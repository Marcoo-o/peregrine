package com.peregrinemobile

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class IncomingRequestTest {
  private val view = "android.intent.action.VIEW"
  private val sendTo = "android.intent.action.SENDTO"

  @After
  fun forget() {
    IncomingRequest.consume()
  }

  private fun request(subject: String) = IncomingRequest.Request(null, subject, "", emptyList(), emptyList(), emptyList(), emptyList())

  @Test
  fun a_view_or_a_send_to_of_a_mailto_link_is_a_link_to_write_to() {
    assertEquals("mailto:sam@example.org", IncomingRequest.mailtoOf(view, "mailto:sam@example.org"))
    assertEquals("MAILTO:sam@example.org?subject=Hi", IncomingRequest.mailtoOf(sendTo, "MAILTO:sam@example.org?subject=Hi"))
  }

  @Test
  fun anything_else_is_not() {
    assertNull(IncomingRequest.mailtoOf(view, "https://example.org"))
    assertNull(IncomingRequest.mailtoOf(view, null))
    assertNull(IncomingRequest.mailtoOf("android.intent.action.SEND", "mailto:sam@example.org"))
    assertNull(IncomingRequest.mailtoOf(null, "mailto:sam@example.org"))
  }

  @Test
  fun a_content_address_of_another_application_is_readable() {
    assertTrue(IncomingRequest.readableStream("content://com.example.photos/media/42", "com.peregrinemobile.files"))
    assertTrue(IncomingRequest.readableStream("CONTENT://com.example.photos/media/42", "com.peregrinemobile.files"))
  }

  @Test
  fun a_path_is_not_since_it_would_be_read_with_what_only_this_application_may_read() {
    assertFalse(IncomingRequest.readableStream("file:///data/user/0/com.peregrinemobile/databases/mail.db", "com.peregrinemobile.files"))
    assertFalse(IncomingRequest.readableStream("/data/user/0/com.peregrinemobile/files/x", "com.peregrinemobile.files"))
  }

  @Test
  fun the_provider_of_this_application_is_not_either_however_the_address_is_written() {
    assertFalse(IncomingRequest.readableStream("content://com.peregrinemobile.files/outgoing/x", "com.peregrinemobile.files"))
    assertFalse(IncomingRequest.readableStream("content://COM.PEREGRINEMOBILE.FILES/outgoing/x", "com.peregrinemobile.files"))
    assertFalse(IncomingRequest.readableStream("content://someone@com.peregrinemobile.files/outgoing/x", "com.peregrinemobile.files"))
  }

  @Test
  fun a_request_is_given_once() {
    IncomingRequest.remember(request("a"))
    assertEquals("a", IncomingRequest.consume()?.subject)
    assertNull(IncomingRequest.consume())
  }

  @Test
  fun the_newest_request_is_the_one_kept_and_none_leaves_what_was_kept() {
    IncomingRequest.remember(request("a"))
    IncomingRequest.remember(request("b"))
    IncomingRequest.remember(null)
    assertEquals("b", IncomingRequest.consume()?.subject)
  }
}
