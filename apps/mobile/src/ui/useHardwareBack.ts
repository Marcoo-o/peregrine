import { useEffect, useRef } from 'react'
import { BackHandler } from 'react-native'
import type { Application } from '../app/Application'
import { backAction } from '../app/backAction'
import type { Screen } from '../app/screens'

/**
 * Makes the back key of the phone do what the way back of the screen does. The sidebar is put away first when it is
 * open. It is registered once and reads what is current, so that it stays below the handlers that screens put on
 * top of it, such as the one that ends the choice of messages, and those are asked first.
 */
export function useHardwareBack(application: Application | null, screen: Screen, sidebar: { isOpen: () => boolean; close: () => void }): void {
  const current = useRef({ application, screen, sidebar })
  current.current = { application, screen, sidebar }

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      const { application: app, screen: shown, sidebar: drawer } = current.current
      if (drawer.isOpen()) {
        drawer.close()
        return true
      }
      const back = app ? backAction(app, shown, () => BackHandler.exitApp()) : null
      if (!back) return false
      back()
      return true
    })
    return () => subscription.remove()
  }, [])
}
