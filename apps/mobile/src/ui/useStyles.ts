import { stylesFor, type Styles } from './styles'
import { useTheme } from './useTheme'

/** The styles of the theme the system has now. */
export function useStyles(): Styles {
  return stylesFor(useTheme())
}
