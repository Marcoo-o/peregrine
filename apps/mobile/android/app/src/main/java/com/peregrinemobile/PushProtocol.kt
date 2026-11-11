package com.peregrinemobile

/**
 * The names of the protocol between the application and the push service of a system, which are all made from the package of that service: its receiver of
 * registrations, the actions it is sent, the action it wakes the application with, and the two permissions (to register, and to deliver a wake). The package is a
 * parameter of the build (`BuildConfig.PUSH_PROVIDER`, `manifestPlaceholders`), so that the application names no system but the one it is built for.
 */
object PushProtocol {
  fun receiver(provider: String) = "$provider.RegistrationReceiver"

  fun actionRegister(provider: String) = "$provider.action.REGISTER"

  fun actionUnregister(provider: String) = "$provider.action.UNREGISTER"

  fun actionUnregisterAll(provider: String) = "$provider.action.UNREGISTER_ALL"

  /** What the service wakes the application with. The manifest declares the same name. */
  fun actionWake(provider: String) = "$provider.action.WAKE"

  fun permissionRegister(provider: String) = "$provider.permission.PUSH_REGISTER"

  fun permissionDeliver(provider: String) = "$provider.permission.PUSH_DELIVER"
}
