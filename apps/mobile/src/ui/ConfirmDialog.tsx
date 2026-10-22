import { Modal, Pressable, Text } from 'react-native'
import { Button, type ButtonVariant } from './controls'
import { useStyles } from './useStyles'

/** One way out of a question: what it says, how loudly, and what it does. */
export interface Answer {
  label: string
  variant?: ButtonVariant
  onPress: () => void
}

/**
 * A question to answer before something is done that cannot be taken back, or before a choice between ways of leaving.
 * The answers are shown in the order given, so that the one that does the least harm is first, and the filled one is
 * the one that is the safest, so that a tap that was meant for something else does not do the harm. Leaving the
 * question by the back key or beside it is the first answer's, which is not doing anything.
 */
export function ConfirmDialog(props: { visible: boolean; title: string; text: string; answers: Answer[] }) {
  const styles = useStyles()
  const [dismissing] = props.answers
  return (
    <Modal transparent visible={props.visible} animationType="fade" onRequestClose={dismissing.onPress}>
      <Pressable style={styles.backdrop} onPress={dismissing.onPress}>
        {/* A tap inside the dialog is not a tap beside it. */}
        <Pressable style={styles.dialog} onPress={() => undefined}>
          <Text accessibilityRole="header" style={styles.dialogTitle}>
            {props.title}
          </Text>
          <Text style={styles.noticeDetail}>{props.text}</Text>
          {props.answers.map((answer) => (
            <Button key={answer.label} label={answer.label} variant={answer.variant} onPress={answer.onPress} />
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  )
}
