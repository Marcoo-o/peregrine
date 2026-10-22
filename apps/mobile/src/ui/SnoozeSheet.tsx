import { Modal, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { snoozeOptions } from './snoozeText'
import { useStyles } from './useStyles'

/**
 * The moments a message can be put aside until, from the bottom of the screen: each preset with the time it comes to,
 * as the desktop offers them, and a line that says where the setting is kept. A tap on one does it and takes the sheet away.
 */
export function SnoozeSheet(props: { visible: boolean; onChoose: (until: number) => void; onClose: () => void }) {
  const styles = useStyles()
  const { bottom } = useSafeAreaInsets()
  // Read when the sheet is opened and not when the screen is drawn: "this evening" is a different moment at nine.
  const options = props.visible ? snoozeOptions(new Date()) : []
  return (
    <Modal transparent visible={props.visible} animationType="fade" onRequestClose={props.onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={props.onClose}>
        {/* A tap inside the sheet is not a tap beside it. */}
        <Pressable style={[styles.sheet, { paddingBottom: 24 + bottom }]} onPress={() => undefined}>
          <Text accessibilityRole="header" style={styles.dialogTitle}>
            Später erinnern
          </Text>
          {options.map((option) => (
            <Pressable
              key={option.preset}
              accessibilityRole="button"
              accessibilityLabel={`${option.label}, ${option.when}`}
              style={styles.tagSheetRow}
              onPress={() => {
                props.onClose()
                props.onChoose(option.until)
              }}
            >
              <Text style={styles.sheetText}>{option.label}</Text>
              <View style={styles.fill} />
              <Text style={styles.itemMeta}>{option.when}</Text>
            </Pressable>
          ))}
          <Text style={styles.hint}>Gilt nur hier: auf anderen Geräten bleibt die Nachricht im Posteingang.</Text>
        </Pressable>
      </Pressable>
    </Modal>
  )
}
