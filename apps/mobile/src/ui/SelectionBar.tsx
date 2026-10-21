import { Pressable, ScrollView, Text, View } from 'react-native'
import { Chip } from './controls'
import type { Selection } from './useSelection'
import { useStyles } from './useStyles'

/** The top of a list while messages are chosen: how many, and the way out of the choice, and choosing all. */
export function SelectionHeader(props: { selection: Selection; total: number }) {
  const styles = useStyles()
  const { selection } = props
  return (
    <View style={styles.selectionHeader}>
      <Pressable accessibilityRole="button" style={styles.back} onPress={selection.clear}>
        <Text style={styles.backText}>✕ Abbrechen</Text>
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
export function SelectionBar(props: { selection: Selection }) {
  const styles = useStyles()
  const { selection } = props
  return (
    <View style={styles.actionBar}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actionBarContent}>
        <Chip label="Gelesen" active={false} onPress={() => void selection.markRead(true)} />
        <Chip label="Ungelesen" active={false} onPress={() => void selection.markRead(false)} />
        <Chip label="★" active={false} onPress={() => void selection.toggleStar()} />
        <Chip label="Archivieren" active={false} onPress={() => void selection.archive()} />
        <Chip label="Spam" active={false} onPress={() => void selection.markAsJunk()} />
        <Chip label="Löschen" active={false} onPress={() => void selection.remove()} />
      </ScrollView>
    </View>
  )
}
