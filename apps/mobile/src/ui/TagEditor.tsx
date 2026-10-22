import { useState } from 'react'
import { KeyboardAvoidingView, Modal, Pressable, Text, TextInput } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { TAG_COLORS } from '@peregrine/core/tags'
import type { Tag } from '../tags'
import { Button } from './controls'
import { TagColors } from './TagColors'
import { useStyles } from './useStyles'
import { useTheme } from './useTheme'

/**
 * A tag to make, or one to change, from the bottom of the screen: its name and its colour. Only what the user sees
 * is changed: the keyword that goes to the server stays what it was, which the line under the name says. It is made
 * when it is opened, and is made again for another tag, so that it starts with the name and the colour of that tag.
 */
export function TagEditor(props: {
  /** The tag that is changed, or null for one that is made. */
  tag: Tag | null
  onSave: (name: string, color: string) => void
  /** Asks to forget the tag; there is none for a tag that is made. */
  onDelete?: () => void
  onClose: () => void
}) {
  const styles = useStyles()
  const { colors } = useTheme()
  const { bottom } = useSafeAreaInsets()
  const [name, setName] = useState(props.tag?.name ?? '')
  const [color, setColor] = useState<string>(props.tag?.color ?? TAG_COLORS[0])
  return (
    <Modal transparent visible animationType="fade" onRequestClose={props.onClose}>
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        <Pressable style={styles.sheetBackdrop} onPress={props.onClose}>
          {/* A tap inside the sheet is not a tap beside it. */}
          <Pressable style={[styles.sheet, { paddingBottom: 24 + bottom }]} onPress={() => undefined}>
            <Text accessibilityRole="header" style={styles.dialogTitle}>
              {props.tag ? 'Tag ändern' : 'Neuer Tag'}
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Name"
              placeholderTextColor={colors.muted}
              value={name}
              onChangeText={setName}
              maxLength={40}
              autoFocus
            />
            <TagColors color={color} onChange={setColor} />
            {props.tag ? (
              <Text style={styles.hint}>
                Das Schlüsselwort {props.tag.keyword} auf dem Server bleibt, wie es ist. Geändert werden Name und Farbe auf diesem Gerät.
              </Text>
            ) : null}
            <Button label="Speichern" disabled={name.trim() === ''} onPress={() => props.onSave(name, color)} />
            {props.onDelete ? <Button label="Löschen" variant="danger" onPress={props.onDelete} /> : null}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  )
}
