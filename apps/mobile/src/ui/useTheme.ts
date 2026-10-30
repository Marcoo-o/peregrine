import { useColorScheme } from 'react-native'
import { useSyncExternalStore } from 'react'
import { appearance, schemeFor } from '../appearance'
import { themeFor, type Theme } from './theme'

/** The theme the user chose, or the system's where they chose none, which changes while the application runs when either is switched. */
export function useTheme(): Theme {
  const system = useColorScheme()
  const mode = useSyncExternalStore(appearance.subscribe, () => appearance.mode)
  return themeFor(schemeFor(mode, system))
}
