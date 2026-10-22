import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { tagCoverage, type Tag } from '../tags'
import { Chip } from './controls'
import { Icon } from './Icon'
import { SnoozeSheet } from './SnoozeSheet'
import { TagSheet } from './TagSheet'
import { useTags } from './tags'
import type { Selection } from './useSelection'
import { useStyles } from './useStyles'
import { useTheme } from './useTheme'

/** The top of a list while messages are chosen: how many, and the way out of the choice, and choosing all. */
export function SelectionHeader(props: { selection: Selection; total: number }) {
  const styles = useStyles()
  const { colors } = useTheme()
  const { selection } = props
  return (
    <View style={styles.selectionHeader}>
      <Pressable accessibilityRole="button" style={styles.back} onPress={selection.clear}>
        <Icon name="close" size={20} color={colors.accent} />
        <Text style={styles.backText}>Abbrechen</Text>
      </Pressable>
      <Text accessibilityRole="header" style={styles.selectionCount}>
        {selection.picked.length} ausgewählt
      </Text>
      {selection.picked.length < props.total ? (
        <Pressable accessibilityRole="button" style={styles.back} onPress={selection.chooseAll}>
          <Text style={styles.backText}>Alle</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

/** What can be done to the messages that are chosen, at the bottom, where the thumb is. */
export function SelectionBar(props: {
  selection: Selection
  /** The flags of each message that is chosen, which say which tags they have. */
  flagLists: string[][]
  /** Whether the list is the one of the messages that are put aside, where they are brought back and not put aside. */
  snoozedList?: boolean
  onCreateTag: (name: string, color: string) => Promise<Tag | undefined>
}) {
  const styles = useStyles()
  const tags = useTags()
  const [tagging, setTagging] = useState(false)
  const [snoozing, setSnoozing] = useState(false)
  const { selection } = props
  return (
    <View style={styles.actionBar}>
      <SnoozeSheet visible={snoozing} onChoose={(until) => void selection.snooze(until)} onClose={() => setSnoozing(false)} />
      <TagSheet
        visible={tagging}
        tags={tags}
        coverage={(keyword) => tagCoverage(props.flagLists, keyword)}
        onSet={(keyword, on) => void selection.setTag(keyword, on)}
        onCreate={props.onCreateTag}
        onClose={() => setTagging(false)}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actionBarContent}>
        <Chip label="Gelesen" active={false} onPress={() => void selection.markRead(true)} />
        <Chip label="Ungelesen" active={false} onPress={() => void selection.markRead(false)} />
        <Chip label="★" active={false} onPress={() => void selection.toggleStar()} />
        <Chip label="Tags" active={false} onPress={() => setTagging(true)} />
        {props.snoozedList ? (
          <Chip label="Zurückholen" active={false} onPress={() => void selection.snooze(null)} />
        ) : (
          <Chip label="Später erinnern" active={false} onPress={() => setSnoozing(true)} />
        )}
        <Chip label="Archivieren" active={false} onPress={() => void selection.archive()} />
        <Chip label="Spam" active={false} onPress={() => void selection.markAsJunk()} />
        <Chip label="Löschen" active={false} onPress={() => void selection.remove()} />
      </ScrollView>
    </View>
  )
}
