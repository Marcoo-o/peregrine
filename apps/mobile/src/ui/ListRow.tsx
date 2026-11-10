import { Pressable, Text, View } from 'react-native'
import { Icon, type IconName } from './Icon'
import { useStyles } from './useStyles'
import { useTheme } from './useTheme'
import { t } from '../i18n'

/**
 * A line of a list that leads somewhere: what it is, a line about it, and an arrow. It can carry the colour
 * of an account in front, a picture of what it is, and a count behind, which is how the desktop marks the
 * folders that have unread mail.
 */
export function ListRow(props: {
  title: string
  meta?: string
  color?: string
  icon?: IconName
  count?: number
  /** How deep it sits in a tree, which is how far it is moved in. */
  depth?: number
  /** Whether it is open: a button to close or open it, or null for a place with nothing under it. Left out, no room is made. */
  expanded?: boolean | null
  onToggle?: () => void
  onPress: () => void
  /** What a long press does, where there is something: a folder opens what can be done to it. */
  onLongPress?: () => void
}) {
  const styles = useStyles()
  const { colors } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      style={[styles.item, styles.listRow, { paddingLeft: (props.depth ?? 0) * 20 }]}
      onPress={props.onPress}
      onLongPress={props.onLongPress}
    >
      {props.expanded !== undefined ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={props.expanded ? t('Zuklappen') : t('Aufklappen')}
          accessibilityState={{ expanded: props.expanded ?? undefined }}
          disabled={props.expanded === null}
          hitSlop={8}
          style={styles.expander}
          onPress={props.onToggle}
        >
          {props.expanded === null ? null : (
            <Icon name={props.expanded ? 'chevronDown' : 'chevronRight'} size={16} color={colors.muted} />
          )}
        </Pressable>
      ) : null}
      {props.color ? <View style={[styles.dot, { backgroundColor: props.color }]} /> : null}
      {props.icon ? (
        <View style={styles.rowIcon}>
          <Icon name={props.icon} size={20} color={colors.muted} />
        </View>
      ) : null}
      <View style={styles.fill}>
        <Text style={styles.itemTitle}>{props.title}</Text>
        {props.meta ? <Text style={styles.itemMeta}>{props.meta}</Text> : null}
      </View>
      {props.count ? <Text style={styles.count}>{props.count}</Text> : null}
      <Icon name="chevronRight" size={18} color={colors.muted} />
    </Pressable>
  )
}
