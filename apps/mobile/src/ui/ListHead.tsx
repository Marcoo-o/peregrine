import { ScrollView, Text, View } from 'react-native'
import { useState } from 'react'
import { countText, type ListFilter } from '../listFilter'
import { SORT_CHOICES, sortLabel } from '../listSort'
import { ActionSheet } from './ActionSheet'
import { Chip } from './controls'
import { useTags } from './tags'
import { useSort } from './sort'
import { useStyles } from './useStyles'
import { t } from '../i18n'

/**
 * The line over a list, as the desktop has it over its own: what the list is, how many messages it has, and the
 * three filters that narrow it to what is not read, what is starred and what has a file.
 */
export function ListHead(props: {
  title: string
  /** Where the list is from, in a small line over its name: the account, or that it is all of them. */
  subtitle?: string
  /** How many the list has, and how many of them the filters leave. */
  total: number
  shown: number
  filter: ListFilter
  onFilter: (filter: ListFilter) => void
}) {
  const styles = useStyles()
  const { filter } = props
  const tags = useTags()
  const { sort, setSort } = useSort()
  const [choosing, setChoosing] = useState(false)
  return (
    <View>
      {props.subtitle ? <Text style={styles.listSubtitle}>{props.subtitle}</Text> : null}
      <View style={styles.listTitleRow}>
        <Text accessibilityRole="header" style={styles.listTitle} numberOfLines={1}>
          {props.title}
        </Text>
        <Text style={styles.listCount}>{countText(props.shown, props.total)}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        <Chip label={sortLabel(sort)} active={false} onPress={() => setChoosing(true)} />
        <Chip label={t('Ungelesen')} icon="unread" active={filter.unread} onPress={() => props.onFilter({ ...filter, unread: !filter.unread })} />
        <Chip label={t('Markiert')} icon="star" active={filter.starred} onPress={() => props.onFilter({ ...filter, starred: !filter.starred })} />
        <Chip
          label={t('Anhänge')}
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
      <ActionSheet
        visible={choosing}
        actions={SORT_CHOICES.map((choice) => ({ label: t(choice.label), onPress: () => setSort(choice.sort) }))}
        onClose={() => setChoosing(false)}
      />
    </View>
  )
}
