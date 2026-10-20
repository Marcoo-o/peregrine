import { useEffect, useState, useSyncExternalStore } from 'react'
import { AppState, StatusBar } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { Application, createApplication } from './src/app/Application'
import { isOnline } from './src/app/queueStatus'
import { showsQueueStatus } from './src/app/screens'
import { AppStore } from './src/app/store'
import { openDatabase } from './src/database'
import { describeError } from './src/errors'
import { createPlatform } from './src/platform'
import { LoadingScreen } from './src/ui/LoadingScreen'
import { ScreenView } from './src/ui/ScreenView'
import { StatusLine } from './src/ui/StatusLine'
import { useStyles } from './src/ui/useStyles'
import { useTheme } from './src/ui/useTheme'

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
  const styles = useStyles()
  const { scheme } = useTheme()

  useEffect(() => {
    let cancelled = false
    let started: Application | undefined
    // A tap on a notification arrives here when the application is running already and comes forward.
    const watching = AppState.addEventListener('change', (next) => {
      if (next === 'active') void started?.openLaunchTarget()
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

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
      <SafeAreaView style={styles.page}>
        {application && showsQueueStatus(state.screen) ? (
          <StatusLine
            online={isOnline(state)}
            waiting={state.waiting}
            onDiscard={() => application.discardFailedActions()}
          />
        ) : null}
        {application ? <ScreenView application={application} screen={state.screen} /> : <LoadingScreen />}
      </SafeAreaView>
    </SafeAreaProvider>
  )
}
