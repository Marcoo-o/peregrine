package com.peregrinemobile

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/** The native modules the application has of its own: the network, the database key, the files, notifications, the schedule of the look for mail, the hashing that opens a sealed key, the address book, and the screen lock. */
class PeregrinePackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
    listOf(
      PeregrineTransportModule(context),
      PeregrineKeystoreModule(context),
      PeregrineFilesModule(context),
      PeregrineNotificationsModule(context),
      PeregrineSyncModule(context),
      PeregrinePushModule(context),
      PeregrinePgpModule(context),
      PeregrineContactsModule(context),
      PeregrineLockModule(context)
    )

  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
