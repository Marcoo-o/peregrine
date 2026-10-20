import { ActivityIndicator, Pressable, Text } from 'react-native'
import { useStyles } from './useStyles'
import { useTheme } from './useTheme'

export type ButtonVariant = 'primary' | 'secondary' | 'danger'

/** What can be done on a screen. The main thing is filled, the others have an outline, and what destroys is red. */
export function Button(props: { label: string; onPress: () => void; disabled?: boolean; variant?: ButtonVariant }) {
  const styles = useStyles()
  const variant = props.variant ?? 'primary'
  const box = { primary: styles.button, secondary: styles.buttonSecondary, danger: styles.buttonDanger }[variant]
  const text = { primary: styles.buttonText, secondary: styles.buttonTextSecondary, danger: styles.buttonTextDanger }[variant]
  return (
    <Pressable
      accessibilityRole="button"
      style={[box, props.disabled && styles.buttonDisabled]}
      disabled={props.disabled}
      onPress={props.onPress}
    >
      <Text style={text}>{props.label}</Text>
    </Pressable>
  )
}

/** A small thing to do, or one of several to choose from, which is tinted when it is the one chosen. */
export function Chip(props: { label: string; active: boolean; onPress: () => void; disabled?: boolean }) {
  const styles = useStyles()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.active, disabled: props.disabled }}
      // The chip is 40 tall, and what is tapped is 48.
      hitSlop={4}
      style={[styles.chip, props.active && styles.chipActive, props.disabled && styles.buttonDisabled]}
      disabled={props.disabled}
      onPress={props.onPress}
    >
      <Text style={props.active ? styles.chipTextActive : styles.chipText}>{props.label}</Text>
    </Pressable>
  )
}

/** Something is being waited for. */
export function Spinner(props: { size?: 'small' | 'large' }) {
  const styles = useStyles()
  const { colors } = useTheme()
  return <ActivityIndicator style={styles.spinner} size={props.size ?? 'small'} color={colors.accent} />
}
