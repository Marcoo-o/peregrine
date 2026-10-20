import { Pressable, Text } from 'react-native'
import { useStyles } from './useStyles'

/**
 * The top of a screen: the way back to the screen before, which every screen but the first has, and what
 * this screen is. What the way back leads to is its label.
 */
export function Header(props: { title: string; back?: { label: string; onPress: () => void } }) {
  const styles = useStyles()
  return (
    <>
      {props.back ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Zurück: ${props.back.label}`}
          style={styles.back}
          onPress={props.back.onPress}
        >
          <Text style={styles.backText}>‹ {props.back.label}</Text>
        </Pressable>
      ) : null}
      <Text accessibilityRole="header" style={styles.title} numberOfLines={2}>
        {props.title}
      </Text>
    </>
  )
}
