import { Pressable, Text, View } from 'react-native'
import { failedText, scheduledText, waitingText } from '../app/queueStatus'
import type { QueueStatus } from '../app/store'
import { useStyles } from './useStyles'
import { t } from '../i18n'

/** Whether there is a connection, and what waits for one. A failure is said, with its reason. */
export function StatusLine(props: { online: boolean; waiting: QueueStatus | null; onDiscard: () => void; onScheduled: () => void }) {
  const styles = useStyles()
  const summary = props.waiting?.summary
  const lines = [props.online ? null : t('Keine Verbindung'), summary ? waitingText(summary) : null].filter(Boolean)
  const failed = summary ? failedText(summary) : null
  const planned = summary ? scheduledText(summary) : null
  if (lines.length === 0 && !failed && !planned) return null
  return (
    <View style={styles.status}>
      {lines.map((line) => (
        <Text key={line} style={styles.statusText}>
          {line}
        </Text>
      ))}
      {planned ? (
        <Pressable accessibilityRole="button" onPress={props.onScheduled}>
          <Text style={styles.statusText}>{t('{planned}. Ansehen', { planned })}</Text>
        </Pressable>
      ) : null}
      {props.waiting?.problem ? <Text style={styles.statusProblem}>{props.waiting.problem}</Text> : null}
      {failed ? (
        <Pressable onPress={props.onDiscard}>
          <Text style={styles.statusProblem}>{t('{failed} Verwerfen', { failed })}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}
