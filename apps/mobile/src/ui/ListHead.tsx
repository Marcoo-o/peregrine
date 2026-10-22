import { ScrollView, Text, View } from 'react-native'
import { countText, type ListFilter } from '../listFilter'
import { Chip } from './controls'
import { useTags } from './tags'
import { useStyles } from './useStyles'

/**
 * The line over a list, as the desktop has it over its own: what the list is, how many messages it has, and the
 * three filters that narrow it to what is not read, what is starred and what has a file.
 */
export function ListHead(props: {
  title: string
  /** How many the list has, and how many of them the filters leave. */
  total: number
  shown: number
  filter: ListFilter
  onFilter: (filter: ListFilter) => void
}) {
  const styles = useStyles()
  const { filter } = props
  const tags = useTags()
  return (
    <View>
      <View style={styles.listTitleRow}>
        <Text accessibilityRole="header" style={styles.listTitle} numberOfLines={1}>
          {props.title}
        </Text>
        <Text style={styles.listCount}>{countText(props.shown, props.total)}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        <Chip label="Ungelesen" icon="unread" active={filter.unread} onPress={() => props.onFilter({ ...filter, unread: !filter.unread })} />
        <Chip label="Markiert" icon="star" active={filter.starred} onPress={() => props.onFilter({ ...filter, starred: !filter.starred })} />
        <Chip
          label="Anhänge"
          icon="attachment"
          active={filter.attachments}
          onPress={() => props.onFilter({ ...filter, attachments: !filter.attachments })}
        />
        {tags.map((tag) => (
          <Chip
            key={tag.id}
            label={tag.name}
            dot={tag.color}
            active={filter.tag === tag.keyword}
            onPress={() => props.onFilter({ ...filter, tag: filter.tag === tag.keyword ? null : tag.keyword })}
          />
        ))}
      </ScrollView>
    </View>
  )
}
