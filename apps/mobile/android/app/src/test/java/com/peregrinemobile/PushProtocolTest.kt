package com.peregrinemobile

import org.junit.Assert.assertEquals
import org.junit.Test

class PushProtocolTest {
  @Test
  fun makesEveryNameFromThePackageOfTheService() {
    val provider = "org.example.push"
    assertEquals("org.example.push.RegistrationReceiver", PushProtocol.receiver(provider))
    assertEquals("org.example.push.action.REGISTER", PushProtocol.actionRegister(provider))
    assertEquals("org.example.push.action.UNREGISTER", PushProtocol.actionUnregister(provider))
    assertEquals("org.example.push.action.UNREGISTER_ALL", PushProtocol.actionUnregisterAll(provider))
    assertEquals("org.example.push.action.WAKE", PushProtocol.actionWake(provider))
    assertEquals("org.example.push.permission.PUSH_REGISTER", PushProtocol.permissionRegister(provider))
    assertEquals("org.example.push.permission.PUSH_DELIVER", PushProtocol.permissionDeliver(provider))
  }

  @Test
  fun hasOnlyTheApplicationsOwnNamesInTheProviderThatABuildHasWithoutBeingToldAnother() {
    assertEquals("app.peregrine.push.RegistrationReceiver", PushProtocol.receiver(DEFAULT))
    assertEquals("app.peregrine.push.action.WAKE", PushProtocol.actionWake(DEFAULT))
    assertEquals("app.peregrine.push.permission.PUSH_REGISTER", PushProtocol.permissionRegister(DEFAULT))
    assertEquals("app.peregrine.push.permission.PUSH_DELIVER", PushProtocol.permissionDeliver(DEFAULT))
  }

  private companion object {
    const val DEFAULT = "app.peregrine.push"
  }
}
