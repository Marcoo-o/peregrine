import { Pressable, Text, View } from 'react-native'
import { failedText, waitingText } from '../app/queueStatus'
import type { QueueStatus } from '../app/store'
import { useStyles } from './useStyles'

/** Whether there is a connection, and what waits for one. A failure is said, with its reason. */
export function StatusLine(props: { online: boolean; waiting: QueueStatus | null; onDiscard: () => void }) {
  const styles = useStyles()
  const summary = props.waiting?.summary
  const lines = [props.online ? null : 'Keine Verbindung', summary ? waitingText(summary) : null].filter(Boolean)
  const failed = summary ? failedText(summary) : null
  if (lines.length === 0 && !failed) return null
  return (
    <View style={styles.status}>
      {lines.length > 0 ? <Text style={styles.statusText}>{lines.join(' · ')}</Text> : null}
      {props.waiting?.problem ? <Text style={styles.statusProblem}>{props.waiting.problem}</Text> : null}
      {failed ? (
        <Pressable onPress={props.onDiscard}>
          <Text style={styles.statusProblem}>{failed} Verwerfen</Text>
        </Pressable>
      ) : null}
    </View>
  )
}
