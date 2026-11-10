import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { AppState, DrawerLayoutAndroid, StatusBar, Text, useWindowDimensions, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { Application, createApplication } from './src/app/Application'
import { isListScreen, isWide, paneWidths } from './src/app/panes'
import { isOnline } from './src/app/queueStatus'
import { showsQueueStatus } from './src/app/screens'
import { AppStore } from './src/app/store'
import { openDatabase } from './src/database'
import { describeError } from './src/errors'
import { createPlatform } from './src/platform'
import type { SidebarData } from './src/sidebar'
import { DrawerContext, locationOf, showsDrawer } from './src/ui/drawer'
import { SafetyContext } from './src/ui/safety'
import { SortContext } from './src/ui/sort'
import { TagsContext } from './src/ui/tags'
import { useHardwareBack } from './src/ui/useHardwareBack'
import { LoadingScreen } from './src/ui/LoadingScreen'
import { LockScreen } from './src/ui/LockScreen'
import { OpenMessageContext } from './src/ui/openMessage'
import { ScreenView } from './src/ui/ScreenView'
import { Sidebar } from './src/ui/Sidebar'
import { StatusLine } from './src/ui/StatusLine'
import { UndoBar } from './src/ui/UndoBar'
import { useStyles } from './src/ui/useStyles'
import { useTheme } from './src/ui/useTheme'
import { language, t } from './src/i18n'

/**
 * The prototype of stage 5: any number of accounts, a unified inbox, the folders of an account, a
 * message opened, answered, marked, moved or deleted, files attached and a new message written.
 * Everything that changes mail goes through the offline queue, so the screens work the same without
 * a connection. What the screens do is in `src/app`, and what they look like in `src/ui`, in the colours
 * of the theme the system has chosen.
 */
export default function App() {
  const [store] = useState(() => new AppStore())
  const [application, setApplication] = useState<Application | null>(null)
  const state = useSyncExternalStore(store.subscribe, () => store.state)
  useSyncExternalStore(language.subscribe, () => language.code + language.choice)
  const styles = useStyles()
  const { scheme, colors } = useTheme()
  const drawer = useRef<InstanceType<typeof DrawerLayoutAndroid>>(null)
  const [sidebar, setSidebar] = useState<SidebarData | null>(null)
  const sortControl = useMemo(
    () => ({ sort: state.sort, setSort: (sort: typeof state.sort) => void application?.settings.setSort(sort), conversations: state.conversations }),
    [state.sort, state.conversations, application]
  )
  const { width } = useWindowDimensions()
  // A wide window shows the list and the message that is open side by side.
  const split = !state.locked && isWide(width) && state.screen.name === 'message' && state.pane !== null
  // The list alone in a wide window keeps its place on the left and leaves the right for the message it will open.
  const waiting = !state.locked && isWide(width) && isListScreen(state.screen)
  const left = split ? state.pane : waiting ? state.screen : null
  const drawerControl = useMemo(() => ({ open: () => drawer.current?.openDrawer() }), [])
  const drawerOpen = useRef(false)
  const sidebarControl = useMemo(() => ({ isOpen: () => drawerOpen.current, close: () => drawer.current?.closeDrawer() }), [])
  useHardwareBack(application, state.screen, sidebarControl)

  useEffect(() => {
    let cancelled = false
    let started: Application | undefined
    // A tap on a notification arrives here when the application is running already and comes forward.
    const watching = AppState.addEventListener('change', (next) => {
      if (next === 'active') void started?.comeToFront()
      else if (next === 'background') started?.lock.wentAway()
    })
    ;(async () => {
      try {
        const db = await openDatabase()
        if (cancelled) return
        started = createApplication(db, createPlatform(), store)
        setApplication(started)
        await started.start()
      } catch (error) {
        if (!cancelled) store.showScreen({ name: 'login', error: describeError(error) })
      }
    })()
    return () => {
      cancelled = true
      watching.remove()
      started?.stop()
    }
  }, [store])

  /** Reads the sidebar again, which is done whenever it is opened so that its counts are those of now. */
  const reloadSidebar = () => {
    if (application) application.navigator.sidebar().then(setSidebar, () => undefined)
  }
  /** Goes where a row of the sidebar leads, and puts the sidebar away. */
  const go = (action: () => unknown) => {
    drawer.current?.closeDrawer()
    void action()
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
      <DrawerLayoutAndroid
        ref={drawer}
        drawerWidth={300}
        drawerPosition="left"
        drawerBackgroundColor={colors.sunken}
        // The sidebar is for the lists and the places that lead to them, and not for a message that is being read.
        drawerLockMode={application && !state.locked && showsDrawer(state.screen.name) ? 'unlocked' : 'locked-closed'}
        onDrawerOpen={() => {
          drawerOpen.current = true
          reloadSidebar()
        }}
        onDrawerClose={() => {
          drawerOpen.current = false
        }}
        renderNavigationView={() => (
          <SafeAreaView style={{ flex: 1, backgroundColor: colors.sunken }}>
            {application && !state.locked ? (
              <Sidebar
                data={sidebar}
                location={locationOf(state.screen)}
                connected={state.connected}
                onUnified={(role) => go(() => application.navigator.showUnified({ refresh: true, role }))}
                onSearch={(query) => go(() => application.navigator.showSearch(query))}
                onFolder={(account, folder) => go(() => application.navigator.openFolder(account, folder))}
                onAccounts={() => go(() => application.navigator.showAccounts())}
                onAddAccount={() => go(() => application.navigator.showLogin())}
                onSettings={() => go(() => application.settings.show())}
                onTasks={() => go(() => application.tasks.show())}
              />
            ) : null}
          </SafeAreaView>
        )}
      >
        <DrawerContext.Provider value={drawerControl}>
          <SafeAreaView style={styles.page}>
            {application && !state.locked && showsQueueStatus(state.screen) ? (
              <StatusLine
                online={isOnline(state)}
                waiting={state.waiting}
                onDiscard={() => application.discardFailedActions()}
                onScheduled={() => application.compose.showScheduled()}
              />
            ) : null}
            <TagsContext.Provider value={state.tags}>
              <SafetyContext.Provider value={state.safety}>
                <SortContext.Provider value={sortControl}>
                  {application && state.locked ? (
                    <LockScreen onUnlock={() => void application.lock.unlock()} />
                  ) : application && left ? (
                    <View style={{ flex: 1, flexDirection: 'row' }}>
                      <View style={{ width: paneWidths(width).list, borderRightWidth: 1, borderRightColor: colors.border }}>
                        <OpenMessageContext.Provider value={state.screen.name === 'message' ? { folderId: state.screen.folder.id, uid: state.screen.summary.uid } : null}>
                          <ScreenView application={application} screen={left} />
                        </OpenMessageContext.Provider>
                      </View>
                      <View style={{ flex: 1 }}>
                        {split ? (
                          <ScreenView application={application} screen={state.screen} />
                        ) : (
                          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
                            <Text style={{ color: colors.muted, textAlign: 'center' }}>{t('Wähle eine Nachricht, um sie hier zu lesen.')}</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  ) : application ? (
                    <ScreenView application={application} screen={state.screen} />
                  ) : (
                    <LoadingScreen />
                  )}
                </SortContext.Provider>
              </SafetyContext.Provider>
            </TagsContext.Provider>
            {application && !state.locked && state.undo ? (
              <UndoBar undo={state.undo} onUndo={() => application.compose.undoSend()} onDone={() => application.compose.clearUndo()} />
            ) : null}
          </SafeAreaView>
        </DrawerContext.Provider>
      </DrawerLayoutAndroid>
    </SafeAreaProvider>
  )
}
