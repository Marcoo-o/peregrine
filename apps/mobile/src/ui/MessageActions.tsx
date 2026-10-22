import { View } from 'react-native'
import { IconButton } from './controls'
import { useStyles } from './useStyles'
import { useTheme } from './useTheme'

/**
 * What can be done to the open message, as the row of pictures the desktop has over its message, within reach of the
 * thumb. What is done less often, such as moving, marking as unread or as spam, is in the menu behind the last one.
 */
export function MessageActions(props: {
  /** Whether the message has arrived: nothing can be answered before it has. */
  ready: boolean
  /** A message that is a draft is written on and not answered. */
  draft: boolean
  onEdit: () => void
  flagged: boolean
  onReply: () => void
  onReplyAll: () => void
  onForward: () => void
  onArchive: () => void
  onToggleFlag: () => void
  onDelete: () => void
  onMore: () => void
}) {
  const styles = useStyles()
  const { colors } = useTheme()
  if (props.draft) {
    return (
      <View style={styles.actionBar}>
        <View style={styles.actionIcons}>
          <IconButton name="compose" label="Weiterschreiben" disabled={!props.ready} onPress={props.onEdit} />
          <IconButton name="trash" label="Löschen" onPress={props.onDelete} />
        </View>
      </View>
    )
  }
  return (
    <View style={styles.actionBar}>
      <View style={styles.actionIcons}>
        <IconButton name="reply" label="Antworten" disabled={!props.ready} onPress={props.onReply} />
        <IconButton name="replyAll" label="Allen antworten" disabled={!props.ready} onPress={props.onReplyAll} />
        <IconButton name="forward" label="Weiterleiten" disabled={!props.ready} onPress={props.onForward} />
        <IconButton name="archive" label="Archivieren" onPress={props.onArchive} />
        <IconButton
          name="star"
          label={props.flagged ? 'Markierung entfernen' : 'Markieren'}
          color={props.flagged ? colors.warning : undefined}
          filled={props.flagged}
          onPress={props.onToggleFlag}
        />
        <IconButton name="trash" label="Löschen" onPress={props.onDelete} />
        <IconButton name="more" label="Mehr" onPress={props.onMore} />
      </View>
    </View>
  )
}
