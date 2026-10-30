import { useSyncExternalStore } from 'react'
import { fontFactor, fontScale } from '../appearance'
import { stylesFor, type Styles } from './styles'
import { useLook, useTheme } from './useTheme'

/** The styles of the theme in force, the text size and the density the user chose, which all change while the application runs. */
export function useStyles(): Styles {
  const scale = useSyncExternalStore(fontScale.subscribe, () => fontScale.scale)
  const { density } = useLook()
  return stylesFor(useTheme(), fontFactor(scale), density)
}
