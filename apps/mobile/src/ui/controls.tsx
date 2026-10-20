import { Pressable, Text } from 'react-native'
import { styles } from './styles'

export function Button(props: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      style={[styles.button, props.disabled && styles.buttonDisabled]}
      disabled={props.disabled}
      onPress={props.onPress}
    >
      <Text style={styles.buttonText}>{props.label}</Text>
    </Pressable>
  )
}

export function Chip(props: { label: string; active: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      style={[styles.chip, props.active && styles.chipActive, props.disabled && styles.buttonDisabled]}
      disabled={props.disabled}
      onPress={props.onPress}
    >
      <Text style={props.active ? styles.chipTextActive : styles.chipText}>{props.label}</Text>
    </Pressable>
  )
}

/** The way back to the screen before, which every screen but the first has at its top. */
export function BackLink(props: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress}>
      <Text style={styles.link}>{props.label}</Text>
    </Pressable>
  )
}
