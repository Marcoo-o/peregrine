import { Pressable, Text, View } from 'react-native'
import { useStyles } from './useStyles'

/**
 * A line of a list that leads somewhere: what it is, a line about it, and an arrow. It can carry the colour
 * of an account in front, and a count behind, which is how the desktop marks the folders that have unread mail.
 */
export function ListRow(props: {
  title: string
  meta?: string
  color?: string
  count?: number
  /** How deep it sits in a tree, which is how far it is moved in. */
  depth?: number
  /** Whether it is open: a button to close or open it, or null for a place with nothing under it. Left out, no room is made. */
  expanded?: boolean | null
  onToggle?: () => void
  onPress: () => void
}) {
  const styles = useStyles()
  return (
    <Pressable
      accessibilityRole="button"
      style={[styles.item, styles.listRow, { paddingLeft: (props.depth ?? 0) * 20 }]}
      onPress={props.onPress}
    >
      {props.expanded !== undefined ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={props.expanded ? 'Zuklappen' : 'Aufklappen'}
          accessibilityState={{ expanded: props.expanded ?? undefined }}
          disabled={props.expanded === null}
          hitSlop={8}
          style={styles.expander}
          onPress={props.onToggle}
        >
          <Text style={styles.expanderText}>{props.expanded === null ? '' : props.expanded ? '▾' : '▸'}</Text>
        </Pressable>
      ) : null}
      {props.color ? <View style={[styles.dot, { backgroundColor: props.color }]} /> : null}
      <View style={styles.fill}>
        <Text style={styles.itemTitle}>{props.title}</Text>
        {props.meta ? <Text style={styles.itemMeta}>{props.meta}</Text> : null}
      </View>
      {props.count ? <Text style={styles.count}>{props.count}</Text> : null}
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  )
}
