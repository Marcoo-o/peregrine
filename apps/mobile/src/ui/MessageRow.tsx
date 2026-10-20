import { Pressable, Text } from 'react-native'
import { FLAGGED, SEEN } from '../flags'
import type { StoredMessage } from '../messages'
import { styles } from './styles'

/**
 * One message in a list: its subject, marked when it is unread, starred or has attachments, who it is
 * from and when, and a line about where it is on its way to when a move of it waits in the queue.
 */
export function MessageRow(props: {
  message: StoredMessage
  /** Whose message it is, in front of the date: the sender, or the account and the sender. */
  byline: string
  /** What is said about a move that waits for a connection, or nothing. */
  pendingNote?: string
  onPress: () => void
}) {
  const { message } = props
  const unread = !message.flags.includes(SEEN)
  const marks = `${message.flags.includes(FLAGGED) ? '★ ' : ''}${message.hasAttachment ? '📎 ' : ''}`
  const date = message.dateMs ? `  ·  ${new Date(message.dateMs).toLocaleDateString('de-DE')}` : ''
  return (
    <Pressable style={styles.item} onPress={props.onPress}>
      <Text style={[styles.itemTitle, unread && styles.unread]} numberOfLines={1}>
        {marks}
        {message.subject || '(ohne Betreff)'}
      </Text>
      <Text style={styles.itemMeta} numberOfLines={1}>
        {props.byline}
        {date}
      </Text>
      {props.pendingNote ? <Text style={styles.pending}>{props.pendingNote}</Text> : null}
    </Pressable>
  )
}
