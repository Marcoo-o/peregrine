import { Pressable, Text, View } from 'react-native'
import { IconButton } from './controls'
import { useDrawer } from './drawer'
import { Icon } from './Icon'
import { useStyles } from './useStyles'
import { useTheme } from './useTheme'

/**
 * The top of a list, as the top of the desktop's window is: the way to the sidebar, the search, and the two
 * things that are done to the whole of it, bringing it up to date and the settings. A screen with nothing to bring up
 * to date leaves the first out. The search is a field that is only there to be touched, and the search itself has the
 * screen it needs for typing.
 */
export function TopBar(props: { onSearch: () => void; onRefresh?: () => void; onSettings: () => void }) {
  const styles = useStyles()
  const { colors } = useTheme()
  const drawer = useDrawer()
  return (
    <View style={styles.topBar}>
      <IconButton name="menu" label="Menü" onPress={drawer.open} />
      <Pressable accessibilityRole="search" accessibilityLabel="Suchen" style={styles.searchPill} onPress={props.onSearch}>
        <Icon name="search" size={18} color={colors.muted} />
        <Text style={styles.searchPillText} numberOfLines={1}>
          Postfächer durchsuchen
        </Text>
      </Pressable>
      {props.onRefresh ? <IconButton name="refresh" label="Aktualisieren" onPress={props.onRefresh} /> : null}
      <IconButton name="settings" label="Einstellungen" onPress={props.onSettings} />
    </View>
  )
}
