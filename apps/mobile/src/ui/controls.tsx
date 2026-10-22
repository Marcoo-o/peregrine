import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { Icon, type IconName } from './Icon'
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
export function Chip(props: {
  label: string
  active: boolean
  onPress: () => void
  disabled?: boolean
  icon?: IconName
  /** A colour, shown as a dot before the label: the colour of a tag. */
  dot?: string
}) {
  const styles = useStyles()
  const { colors } = useTheme()
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
      <View style={styles.chipContent}>
        {props.dot ? <View style={[styles.tagDot, { backgroundColor: props.dot }]} /> : null}
        {props.icon ? <Icon name={props.icon} size={16} color={props.active ? colors.accent : colors.text} /> : null}
        <Text style={props.active ? styles.chipTextActive : styles.chipText}>{props.label}</Text>
      </View>
    </Pressable>
  )
}

/** A button that is only a picture, as small as a thumb can still hit: what the top of the desktop's window has. */
export function IconButton(props: {
  name: IconName
  label: string
  onPress: () => void
  color?: string
  /** Whether the picture is filled in, which is how a star that is set differs from one that is not. */
  filled?: boolean
  disabled?: boolean
}) {
  const styles = useStyles()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      disabled={props.disabled}
      style={[styles.iconButton, props.disabled && styles.buttonDisabled]}
      onPress={props.onPress}
    >
      <Icon name={props.name} size={22} color={props.color} fill={props.filled ? props.color : undefined} />
    </Pressable>
  )
}

/** The way to write a message, which is always within reach: filled with the accent, as the desktop's first button is. */
export function Fab(props: { label: string; onPress: () => void }) {
  const styles = useStyles()
  const { colors } = useTheme()
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={props.label} style={styles.fab} onPress={props.onPress}>
      <Icon name="compose" size={22} color={colors.onAccent} />
      <Text style={styles.fabText}>{props.label}</Text>
    </Pressable>
  )
}

/** Something is being waited for. */
export function Spinner(props: { size?: 'small' | 'large' }) {
  const styles = useStyles()
  const { colors } = useTheme()
  return <ActivityIndicator style={styles.spinner} size={props.size ?? 'small'} color={colors.accent} />
}
