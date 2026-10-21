import { Pressable, Text, View } from 'react-native'
import { FLAGGED, SEEN } from '../flags'
import type { StoredMessage } from '../messages'
import { senderName } from '../senderName'
import { shortDate } from './shortDate'
import { useStyles } from './useStyles'

/**
 * One message in a list, as the desktop shows one: who it is from and when, its subject, both bold while it
 * is unread, a mark for a star and for attachments, and a stripe in the colour of its account. A line about
 * where it is on its way to is added when a move of it waits in the queue.
 */
export function MessageRow(props: {
  message: StoredMessage
  /** Who it is from. */
  sender: string
  /** The account it is in, said under the subject when the list holds the mail of several. */
  account?: string
  /** The colour of that account, as a stripe at the edge of the row. */
  accountColor?: string
  /** What is said about a move that waits for a connection, or nothing. */
  pendingNote?: string
  /** Whether the list is one that messages are being chosen in, and whether this one is. */
  choosing?: boolean
  chosen?: boolean
  onPress: () => void
  /** What a long press does, which is to choose this message and begin choosing. */
  onLongPress?: () => void
}) {
  const styles = useStyles()
  const { message } = props
  const unread = !message.flags.includes(SEEN)
  const marks = `${message.flags.includes(FLAGGED) ? '★ ' : ''}${message.hasAttachment ? '📎 ' : ''}`
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.chosen }}
      style={[styles.item, styles.messageRow, props.chosen && styles.messageRowChosen]}
      onPress={props.onPress}
      onLongPress={props.onLongPress}
    >
      {props.choosing ? (
        <View style={[styles.check, props.chosen && styles.checkOn]}>
          {props.chosen ? <Text style={styles.checkMark}>✓</Text> : null}
        </View>
      ) : null}
      {props.accountColor ? <View style={[styles.stripe, { backgroundColor: props.accountColor }]} /> : null}
      <View style={styles.fill}>
        <View style={styles.messageHead}>
          <Text style={[styles.sender, unread && styles.unread]} numberOfLines={1}>
            {senderName(props.sender)}
          </Text>
          {message.dateMs ? <Text style={styles.date}>{shortDate(message.dateMs, new Date())}</Text> : null}
        </View>
        <Text style={[styles.subject, unread && styles.unread]} numberOfLines={1}>
          {marks}
          {message.subject || '(ohne Betreff)'}
        </Text>
        {props.account ? <Text style={styles.itemMeta}>{props.account}</Text> : null}
        {props.pendingNote ? <Text style={styles.pending}>{props.pendingNote}</Text> : null}
      </View>
    </Pressable>
  )
}
