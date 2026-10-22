import { useState } from 'react'
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { TAG_COLORS } from '@peregrine/core/tags'
import type { Tag } from '../tags'
import { Chip } from './controls'
import { Icon } from './Icon'
import { TagColors } from './TagColors'
import { useStyles } from './useStyles'
import { useTheme } from './useTheme'

/**
 * The tags to set on the messages that were chosen, or on the one that is open, from the bottom of the screen: each
 * tag with whether none, some or all of the messages have it, a tap setting it on all of them or, when all have it,
 * taking it off, and a field to make a new one, which is set on them at once. The sheet stays while tags are set, so
 * that several can be, and goes with a tap beside it.
 */
export function TagSheet(props: {
  visible: boolean
  tags: Tag[]
  coverage: (keyword: string) => 'none' | 'some' | 'all'
  onSet: (keyword: string, on: boolean) => void
  /** Makes a tag, and gives it back, or nothing when the name is nothing. */
  onCreate: (name: string, color: string) => Promise<Tag | undefined>
  onClose: () => void
}) {
  const styles = useStyles()
  const { colors } = useTheme()
  const { bottom } = useSafeAreaInsets()
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(TAG_COLORS[props.tags.length % TAG_COLORS.length])

  const create = async () => {
    const made = await props.onCreate(name, color)
    if (!made) return
    props.onSet(made.keyword, true)
    setName('')
    setColor(TAG_COLORS[(props.tags.length + 1) % TAG_COLORS.length])
  }

  return (
    <Modal transparent visible={props.visible} animationType="fade" onRequestClose={props.onClose}>
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        <Pressable style={styles.sheetBackdrop} onPress={props.onClose}>
          {/* A tap inside the sheet is not a tap beside it. */}
          <Pressable style={[styles.sheet, { paddingBottom: 24 + bottom }]} onPress={() => undefined}>
            <Text accessibilityRole="header" style={styles.dialogTitle}>
              Tags
            </Text>
            <ScrollView style={styles.tagList} keyboardShouldPersistTaps="handled">
              {props.tags.length === 0 ? <Text style={styles.hint}>Noch keine Tags. Unten lässt sich der erste anlegen.</Text> : null}
              {props.tags.map((tag) => {
                const coverage = props.coverage(tag.keyword)
                return (
                  <Pressable
                    key={tag.id}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: coverage === 'all' ? true : coverage === 'some' ? 'mixed' : false }}
                    style={styles.tagSheetRow}
                    onPress={() => props.onSet(tag.keyword, coverage !== 'all')}
                  >
                    <View style={[styles.tagDot, { backgroundColor: tag.color }]} />
                    <Text style={styles.sheetText}>{tag.name}</Text>
                    <View style={styles.fill} />
                    {coverage === 'all' ? <Icon name="check" size={20} color={colors.accent} /> : null}
                    {coverage === 'some' ? <Text style={styles.itemMeta}>teils</Text> : null}
                  </Pressable>
                )
              })}
            </ScrollView>
            <TextInput
              style={styles.input}
              placeholder="Neuer Tag"
              placeholderTextColor={colors.muted}
              value={name}
              onChangeText={setName}
              onSubmitEditing={() => void create()}
              returnKeyType="done"
              maxLength={40}
            />
            <TagColors color={color} onChange={setColor} />
            <Chip label="Anlegen und setzen" active={false} disabled={name.trim() === ''} onPress={() => void create()} />
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  )
}
