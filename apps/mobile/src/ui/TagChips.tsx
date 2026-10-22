import { Text, View } from 'react-native'
import { shownTags } from '../tags'
import { useStyles } from './useStyles'
import { useTags } from './tags'

/** How many tags a line of a list shows before it says how many more there are: more than this is a row of nothing else. */
const MOST_IN_A_LIST = 3

/** The tags of a message, as small marks in their colours: in a list the first few, and on a message all of them. */
export function TagChips(props: { flags: readonly string[]; all?: boolean }) {
  const styles = useStyles()
  const tags = shownTags(props.flags, useTags())
  if (tags.length === 0) return null
  const shown = props.all ? tags : tags.slice(0, MOST_IN_A_LIST)
  const hidden = tags.length - shown.length
  return (
    <View style={styles.tagRow}>
      {shown.map((tag) => (
        <View key={tag.keyword} style={[styles.tagChip, { backgroundColor: tag.color }]}>
          <Text style={styles.tagChipText} numberOfLines={1}>
            {tag.name}
          </Text>
        </View>
      ))}
      {hidden > 0 ? <Text style={styles.itemMeta}>+{hidden}</Text> : null}
    </View>
  )
}
