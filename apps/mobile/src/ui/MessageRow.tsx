import { Pressable, Text, View } from 'react-native'
import { FLAGGED, SEEN } from '../flags'
import type { StoredMessage } from '../messages'
import { senderName } from '../senderName'
import { TagChips } from './TagChips'
import { Icon } from './Icon'
import { shortDate } from './shortDate'
import { useStyles } from './useStyles'
import { useTheme } from './useTheme'

/**
 * One message in a list, as the desktop shows one: who it is from and when, its subject, both bold while it
 * is unread, a mark for a star and for attachments, and a stripe in the colour of its account. A line about
 * where it is on its way to is added when a move of it waits in the queue.
 */
export function MessageRow(props: {
  message: StoredMessage
  /** Who it is from. */
  sender: string
  /** Whether the first of its text is shown under the subject. */
  showPreview?: boolean
  /** The account it is in, said under the subject when the list holds the mail of several. */
  account?: string
  /** How many messages the conversation this is the newest of has, when it has more than one, and whether any of them is not read. */
  count?: number
  conversationUnread?: boolean
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
  const { colors } = useTheme()
  const { message } = props
  const unread = !message.flags.includes(SEEN) || props.conversationUnread === true
  const starred = message.flags.includes(FLAGGED)
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
          {props.count && props.count > 1 ? <Text style={styles.threadCount}>{props.count}</Text> : null}
          {message.dateMs ? <Text style={styles.date}>{shortDate(message.dateMs, new Date())}</Text> : null}
        </View>
        <View style={styles.markRow}>
          {starred ? <Icon name="star" size={14} color={colors.warning} fill={colors.warning} /> : null}
          {message.hasAttachment ? <Icon name="attachment" size={14} color={colors.muted} /> : null}
          <Text style={[styles.subject, styles.fill, unread && styles.unread]} numberOfLines={1}>
            {message.subject || '(ohne Betreff)'}
          </Text>
        </View>
        <TagChips flags={message.flags} />
        {props.showPreview !== false && message.preview ? (
          <Text style={styles.preview} numberOfLines={2}>
            {message.preview}
          </Text>
        ) : null}
        {props.account ? <Text style={styles.itemMeta}>{props.account}</Text> : null}
        {props.pendingNote ? <Text style={styles.pending}>{props.pendingNote}</Text> : null}
      </View>
    </Pressable>
  )
}
