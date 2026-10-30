import { useColorScheme } from 'react-native'
import { useSyncExternalStore } from 'react'
import { appearance, look, schemeFor, type Look } from '../appearance'
import { themeFor, type Theme } from './theme'

/** How the application looks besides the theme: the date format and the density, which change while it runs. */
export function useLook(): Look {
  return useSyncExternalStore(look.subscribe, () => look.current)
}

/** The theme the user chose, or the system's where they chose none, in the accent they chose, which change while the application runs when either is switched. */
export function useTheme(): Theme {
  const system = useColorScheme()
  const mode = useSyncExternalStore(appearance.subscribe, () => appearance.mode)
  const { accent } = useLook()
  return themeFor(schemeFor(mode, system), accent)
}
