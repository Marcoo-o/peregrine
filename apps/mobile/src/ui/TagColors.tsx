import { Pressable, View } from 'react-native'
import { TAG_COLORS } from '@peregrine/core/tags'
import { useStyles } from './useStyles'

/** The colours a tag can have, as dots to choose from: the same twelve as the desktop has. */
export function TagColors(props: { color: string; onChange: (color: string) => void }) {
  const styles = useStyles()
  return (
    <View style={styles.tagColors}>
      {TAG_COLORS.map((candidate) => (
        <Pressable
          key={candidate}
          accessibilityRole="radio"
          accessibilityLabel={`Farbe ${candidate}`}
          accessibilityState={{ selected: candidate === props.color }}
          hitSlop={6}
          style={[styles.tagColor, { backgroundColor: candidate }, candidate === props.color && styles.tagColorChosen]}
          onPress={() => props.onChange(candidate)}
        />
      ))}
    </View>
  )
}
