import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { ActionSheet } from './ActionSheet'
import { Icon } from './Icon'
import { useStyles } from './useStyles'
import { useTheme } from './useTheme'

export interface DropdownOption<T extends string> {
  value: T
  label: string
}

/**
 * A choice among several that takes one line and opens as a list from the bottom of the screen, instead of a row of buttons that is as wide as there are
 * choices. It says what is chosen, and a small caption above it says what is being chosen.
 */
export function Dropdown<T extends string>(props: {
  caption?: string
  value: T | null
  options: ReadonlyArray<DropdownOption<T>>
  /** What is said while nothing is chosen. */
  placeholder?: string
  onChange: (value: T) => void
  disabled?: boolean
}) {
  const styles = useStyles()
  const { colors } = useTheme()
  const [open, setOpen] = useState(false)
  const chosen = props.options.find((option) => option.value === props.value)
  return (
    <View style={styles.dropdownBox}>
      {props.caption ? <Text style={styles.dropdownCaption}>{props.caption}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={props.caption} disabled={props.disabled} style={styles.dropdown} onPress={() => setOpen(true)}>
        <Text style={chosen ? styles.dropdownText : styles.dropdownPlaceholder} numberOfLines={1}>
          {chosen?.label ?? props.placeholder ?? ''}
        </Text>
        <Icon name="chevronDown" size={18} color={colors.muted} />
      </Pressable>
      <ActionSheet
        visible={open}
        actions={props.options.map((option) => ({ label: option.label, onPress: () => props.onChange(option.value) }))}
        onClose={() => setOpen(false)}
      />
    </View>
  )
}
