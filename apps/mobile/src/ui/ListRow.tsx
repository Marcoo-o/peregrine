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
  onPress: () => void
}) {
  const styles = useStyles()
  return (
    <Pressable accessibilityRole="button" style={[styles.item, styles.listRow]} onPress={props.onPress}>
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
