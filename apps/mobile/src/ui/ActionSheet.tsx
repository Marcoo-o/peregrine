import { Modal, Pressable, Text, View } from 'react-native'
import { useStyles } from './useStyles'

export interface SheetAction {
  label: string
  onPress: () => void
  /** What destroys is told apart by its colour. */
  danger?: boolean
}

/** A choice of what to do, from the bottom of the screen where a thumb is. Tapping beside it takes it away. */
export function ActionSheet(props: { visible: boolean; actions: SheetAction[]; onClose: () => void }) {
  const styles = useStyles()
  return (
    <Modal transparent visible={props.visible} animationType="fade" onRequestClose={props.onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={props.onClose}>
        <View style={styles.sheet}>
          {props.actions.map((action) => (
            <Pressable
              key={action.label}
              accessibilityRole="button"
              style={styles.sheetItem}
              onPress={() => {
                props.onClose()
                action.onPress()
              }}
            >
              <Text style={action.danger ? styles.sheetTextDanger : styles.sheetText}>{action.label}</Text>
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  )
}
