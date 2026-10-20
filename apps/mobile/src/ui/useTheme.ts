import { useColorScheme } from 'react-native'
import { themeFor, type Theme } from './theme'

/** The theme of the system, which changes while the application runs when the user switches it. */
export function useTheme(): Theme {
  return themeFor(useColorScheme())
}
