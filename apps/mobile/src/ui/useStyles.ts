import { useSyncExternalStore } from 'react'
import { fontFactor, fontScale } from '../appearance'
import { stylesFor, type Styles } from './styles'
import { useTheme } from './useTheme'

/** The styles of the theme in force and the text size the user chose, which both change while the application runs. */
export function useStyles(): Styles {
  const scale = useSyncExternalStore(fontScale.subscribe, () => fontScale.scale)
  return stylesFor(useTheme(), fontFactor(scale))
}
