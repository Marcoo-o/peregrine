import { Modal, Pressable, Text } from 'react-native'
import { Button } from './controls'
import { useStyles } from './useStyles'

/**
 * A question to answer before something that cannot be taken back is done. Not doing it is the first and the
 * filled button, so that a tap that was meant for something else does not do it.
 */
export function ConfirmDialog(props: {
  visible: boolean
  title: string
  text: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const styles = useStyles()
  return (
    <Modal transparent visible={props.visible} animationType="fade" onRequestClose={props.onCancel}>
      <Pressable style={styles.backdrop} onPress={props.onCancel}>
        {/* A tap inside the dialog is not a tap beside it. */}
        <Pressable style={styles.dialog} onPress={() => undefined}>
          <Text accessibilityRole="header" style={styles.dialogTitle}>
            {props.title}
          </Text>
          <Text style={styles.noticeDetail}>{props.text}</Text>
          <Button label="Abbrechen" onPress={props.onCancel} />
          <Button label={props.confirmLabel} variant="danger" onPress={props.onConfirm} />
        </Pressable>
      </Pressable>
    </Modal>
  )
}
