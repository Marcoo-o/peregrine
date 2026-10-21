import { Pressable, Text, View } from 'react-native'
import { useStyles } from './useStyles'

/** The way back to the screen before, which every screen but the first has. What it leads to is its label. */
export function BackBar(props: { label: string; onPress: () => void }) {
  const styles = useStyles()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Zurück: ${props.label}`}
      style={styles.back}
      onPress={props.onPress}
    >
      <Text style={styles.backText}>‹ {props.label}</Text>
    </Pressable>
  )
}

/** What a screen is. */
export function Title(props: { text: string }) {
  const styles = useStyles()
  return (
    <Text accessibilityRole="header" style={styles.title} numberOfLines={2}>
      {props.text}
    </Text>
  )
}

/**
 * The top of a screen: the way back, if there is one, and what the screen is. A thing to do on the screen, such as
 * searching, can stand at the right of the way back.
 */
export function Header(props: {
  title: string
  back?: { label: string; onPress: () => void }
  action?: { label: string; onPress: () => void }
}) {
  const styles = useStyles()
  return (
    <>
      {props.back || props.action ? (
        <View style={styles.headerRow}>
          {props.back ? <BackBar label={props.back.label} onPress={props.back.onPress} /> : <View />}
          {props.action ? (
            <Pressable accessibilityRole="button" style={styles.back} onPress={props.action.onPress}>
              <Text style={styles.backText}>{props.action.label}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <Title text={props.title} />
    </>
  )
}
